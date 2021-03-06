'use strict';

/**
 * Generic helpers for making requests against the Reddit API.
 * @namespace TBApi
 */
(function (TBApi) {
    const logger = TBLog('TBApi');

    /**
     * Sends a generic HTTP request through the background page.
     * @function
     * @param {object} options The options for the AJAX request
     * @param {string} options.method The HTTP method to use for the request
     * @param {string} options.endpoint The endpoint to request
     * @param {object} options.data Query parameters as an object
     * @param {boolean?} options.oauth If true, the request will be sent on
     * oauth.reddit.com, and the `Authorization` header will be set with the
     * OAuth access token for the logged-in user
     * @returns {Promise}
     */
    TBApi.sendRequest = ({method, endpoint, data, oauth}) => browser.runtime.sendMessage({
        action: 'tb-request',
        method,
        endpoint,
        data,
        oauth,
    }).then(response => {
        if (response.errorThrown !== undefined) {
            throw response;
        }
        return response;
    });

    /**
     * Performs a GET request and promises the body of the response, or the
     * full response object on error. Maintains an API similar to
     * `$.getJSON()` because that's what all these calls used before Chrome
     * forced us to make all requests in the background.
     * @function
     * @param {string} endpoint The endpoint to request
     * @param {object} data Query parameters as an object
     */
    TBApi.getJSON = (endpoint, data) => TBApi.sendRequest({method: 'GET', endpoint, data})
        .then(response => response.data)
        .catch(response => {
            throw response.jqXHR;
        });

    /**
     * Performs a POST request and promises the body of the response, or the
     * full response object on error. Maintains an API similar to `$.post`.
     * @function
     * @param {string} endpoint The endpoint to request
     * @param {object} data The body of the request.
     * @returns {Promise} Resolves to response data or rejects with a jqXHR
     */
    TBApi.post = (endpoint, data) => TBApi.sendRequest({
        method: 'POST',
        endpoint,
        data,
    }).then(response => response.data).catch(response => {
        throw response.jqXHR;
    });

    /**
     * Sends an authenticated request against the OAuth API from the
     * background page.
     * @function
     * @param {string} method An HTTP verb
     * @param {string} endpoint The endpoint to request
     * @param {object} data Query parameters as an object
     */
    TBApi.apiOauthRequest = (method, endpoint, data) => TBApi.sendRequest({
        endpoint,
        method,
        data,
        oauth: true,
    });

    /**
     * Sends an authenticated POST request against the OAuth API.
     * @function
     * @param {string} endpoint The endpoint to request
     * @param {object} data Query parameters as an object
     */
    TBApi.apiOauthPOST = TBApi.apiOauthRequest.bind(null, 'POST');

    /**
     * Sends an authenticated GET request against the OAuth API.
     * @function
     * @param {string} endpoint The endpoint to request
     * @param {object} data Query parameters as an object
     */
    TBApi.apiOauthGET = TBApi.apiOauthRequest.bind(null, 'GET');

    //
    // Reddit 'legacy' API stuff. Still very much in use.
    //

    /**
     * Gets ratelimit information from the API.
     * @function
     * @returns {Promise<TBApi~rateLimitDescriptor>}
     */
    TBApi.getRatelimit = () => TBApi.sendRequest({
        method: 'HEAD',
        endpoint: '/r/toolbox/wiki/ratelimit.json',
    }).then(({jqXHR}) => {
        const ratelimitRemaining = jqXHR.allResponseHeaders['x-ratelimit-remaining'],
              ratelimitReset = jqXHR.allResponseHeaders['x-ratelimit-reset'];

        logger.log(`ratelimitRemaining: ${ratelimitRemaining} ratelimitReset: ${ratelimitReset / 60}`);

        /**
         * An object describing the current rate limit.
         * @typedef TBApi~rateLimitDescriptor
         * @property {string} rateLimitRemaining The number of API calls left
         * during this ratelimit period
         * @property {string} rateLimitReset The number of seconds until this
         * ratelimit period ends
         */
        return {
            ratelimitRemaining,
            ratelimitReset,
        };
    });

    /**
      * Updates the content of a wiki page.
      * @function
      * @param {string} page The name of the wiki page
      * @param {string} subreddit The name of the subreddit the page is in
      * @param {string | object} data The new content of the page
      * @param {string} reason A note for the revision history of the page
      * @param {boolean} isJSON If true, `data` is stringified as JSON first
      * @param {boolean} updateAM If true, all tabs are replaced with 4 spaces
      * @returns {Promise} Resolves with no value or rejects with the jqXHR object
      */
    TBApi.postToWiki = async function postToWiki (page, subreddit, data, reason, isJSON, updateAM) {
        if (reason) {
            reason = `"${reason}" via toolbox`;
        } else {
            reason = 'updated via toolbox';
        }

        if (isJSON) {
        // Not indenting saves precious bytes.
        // data = JSON.stringify(data, undefined, TBCore.debugMode ? 2 : undefined);
            data = JSON.stringify(data);
        }

        logger.log(`Posting /r/${subreddit}/api/wiki/edit/${page}`);

        // If we update automoderator we want to replace any tabs with four spaces.
        if (updateAM) {
            data = data.replace(/\t/g, '    ');
        }

        try {
            await TBApi.post(`/r/${subreddit}/api/wiki/edit`, {
                content: data,
                page,
                reason,
                uh: TBCore.modhash,
            });
        } catch (jqXHR) {
            logger.log(jqXHR.responseText);
            throw jqXHR;
        }

        setTimeout(() => {
            // Set page access to 'mod only'.
            TBApi.post(`/r/${subreddit}/wiki/settings/`, {
                page,
                listed: true, // hrm, may need to make this a config setting.
                permlevel: 2,
                uh: TBCore.modhash,
            })

                // Super extra double-secret secure, just to be safe.
                .catch(() => {
                    alert('error setting wiki page to mod only access');
                    window.location = `https://www.reddit.com/r/${subreddit}/wiki/settings/${page}`;
                });
        }, 500);

        await new Promise(resolve => setTimeout(resolve, 750));
    };

    /**
     * Reads data from a wiki page
     * @function
     * @param {string} subreddit The name of the subreddit the page is in
     * @param {string} page The name of the page
     * @param {boolean} isJSON If true, data is parsed as JSON before being returned
     * @returns {Promise} Promises the data of the wiki page. If there is an
     * error reading from the page, one of the following error values may be
     * returned:
     * - TBCore.WIKI_PAGE_UNKNOWN
     * - TBCore.NO_WIKI_PAGE
     * If the isJSON `param` was true, then this will be an object. Otherwise,
     * it will be the raw contents of the wiki as a string.
     */
    TBApi.readFromWiki = (subreddit, page, isJSON) => new Promise(resolve => {
        // We need to demangle the JSON ourselves, so we have to go about it this way :(
        TBApi.sendRequest({
            endpoint: `/r/${subreddit}/wiki/${page}.json`,
        }).then(({data}) => {
            const wikiData = data.data.content_md;
            if (!wikiData) {
                resolve(TBCore.NO_WIKI_PAGE);
                return;
            }
            if (isJSON) {
                let parsedWikiData;
                try {
                    parsedWikiData = JSON.parse(wikiData);
                } catch (err) {
                // we should really have a INVAILD_DATA error for this.
                    logger.log(err);
                    resolve(TBCore.NO_WIKI_PAGE);
                }
                // Moved out of the try so random exceptions don't erase the entire wiki page
                if (parsedWikiData) {
                    resolve(parsedWikiData);
                } else {
                    resolve(TBCore.NO_WIKI_PAGE);
                }
                return;
            }
            // We have valid data, but it's not JSON.
            resolve(wikiData);
        }).catch(({jqXHR, errorThrown}) => {
            logger.log(`Wiki error (${subreddit}/${page}): ${errorThrown}`);
            if (jqXHR.responseText === undefined) {
                resolve(TBCore.WIKI_PAGE_UNKNOWN);
                return;
            }
            let reason;
            if (jqXHR.responseText.startsWith('<!doctype html>')) {
                reason = 'WIKI_PAGE_UNKNOWN';
            } else {
                reason = JSON.parse(jqXHR.responseText).reason || '';
            }

            if (reason === 'PAGE_NOT_CREATED' || reason === 'WIKI_DISABLED') {
                resolve(TBCore.NO_WIKI_PAGE);
            } else {
            // we don't know why it failed, we should not try to write to it.
                resolve(TBCore.WIKI_PAGE_UNKNOWN);
            }
        });
    });

    /**
     * Gets the ban state of a user.
     * @function
     * @param {string} subreddit The name of the subreddit to check in
     * @param {string} user The name of the user to check
     * @returns {Promise<?TBApi~banState>} An object describing the ban, or null
     * if the user is not banned
     */
    TBApi.getBanState = async (subreddit, user) => {
        // Fetch ban info for just this one user
        const data = await TBApi.getJSON(`/r/${subreddit}/about/banned/.json`, {user});
        TBStorage.purifyObject(data);
        const banned = data.data.children;

        // If it's over or under exactly one item they are not banned or that is not their full name.
        if (banned.length !== 1) {
            return null;
        }

        return banned[0];
    };

    /**
     * Describes a subreddit ban.
     * @typedef TBApi~banState
     * @property {string} name The banned user's name
     * @property {string} id The banned user's ID fullname
     * @property {string} note The mod-visible ban note
     * @property {string} date The date the ban was issued
     * @property {?number} days_left If the ban is temporary, the number of days
     * until it expires, otherwise null
     */

    /**
     * Sets a flair on a post.
     * @function
     * @param {string} postLink The post's fullname
     * @param {string} subreddit The name of the subreddit the post is in
     * @param {string} text The flair's text
     * @param {string} cssClass The flair's CSS class
     * @returns {Promise}
     */
    TBApi.flairPost = (postLink, subreddit, text, cssClass) => TBApi.post('/api/flair', {
        api_type: 'json',
        link: postLink,
        text,
        css_class: cssClass,
        r: subreddit,
        uh: TBCore.modhash,
    });

    /**
     * Sets a flair on a user in a subreddit.
     * @function
     * @param {string} user The name of the user
     * @param {string} subreddit The name of the subreddit
     * @param {string} text The flair's text
     * @param {string} cssClass The flair's CSS class
     * @returns {Promise}
     */
    TBApi.flairUser = (user, subreddit, text, cssClass) => TBApi.post('/api/flair', {
        api_type: 'json',
        name: user,
        r: subreddit,
        text,
        css_class: cssClass,
        uh: TBCore.modhash,
    });

    /**
     * Creates a relationship between a user and a subreddit. This is used for:
     * - Banning users
     * - Wikibanning users
     * - Muting users
     * - Adding moderators
     * - Adding wiki contributors
     * - Accepting moderator invitations
     * @function
     * @param {object} options
     * @param {string} options.user The user to apply the relationship to
     * @param {string} options.action The string for the desired action (see
     * {@link https://www.reddit.com/dev/api#POST_api_friend} for a list)
     * @param {string} options.subreddit The sub to apply the relationship in
     * @param {string} [options.banReason] If banning, the private mod note
     * @param {string} [options.banMessage] If banning, the note sent to the user
     * @param {number} [options.banDuration] If banning, the length of the ban (0
     * or undefined for a permanent ban)
     * @param {string} [options.banContext] If banning, a fullname pointing to the
     * link or comment the user is being banned for
     * @returns {Promise} Resolves to the JSON response body or rejects with a
     * jqXHR object
     */
    TBApi.friendUser = function ({
        user,
        action,
        subreddit,
        banReason,
        banMessage,
        banDuration,
        banContext,
    }) {
        const trimmedBanMessage = banMessage.length > 999 ? banMessage.substring(0, 999) : banMessage;
        const trimmedBanReason = banReason.length > 99 ? banReason.substring(0, 99) : banReason;
        if (banDuration) {
            if (banDuration > 999) {
                banDuration = 999;
            }
            if (banDuration < 0) {
                banDuration = 0;
            }
        }

        return TBApi.post('/api/friend', {
            api_type: 'json',
            uh: TBCore.modhash,
            type: action,
            name: user,
            r: subreddit,
            note: trimmedBanReason,
            ban_message: trimmedBanMessage,
            duration: banDuration,
            ban_context: banContext,
        });
    };

    /**
     * Removes a relationship between a user and a subreddit.
     * @param {string} user The name of the user
     * @param {string} action The type of relationship to remove (see
     * {@link https://www.reddit.com/dev/api#POST_api_friend} for a list)
     * @param {string} subreddit The name of the subreddit
     * @returns {Promise} Resolves to response data or rejects with a jqXHR
     */
    TBApi.unfriendUser = (user, action, subreddit) => TBApi.post('/api/unfriend', {
        api_type: 'json',
        uh: TBCore.modhash,
        type: action,
        name: user,
        r: subreddit,
    });

    /**
     * Mod-distinguishes a post or comment.
     * @function
     * @param {string} id The fullname of the post or comment
     * @param {boolean} sticky If distinguishing a top-level comment, whether to
     * also sticky the comment
     * @returns {Promise}
     */
    TBApi.distinguishThing = (id, sticky) => TBApi.post('/api/distinguish/yes', {
        id,
        sticky,
        uh: TBCore.modhash,
    });

    /**
     * Approves a post or comment.
     * @function
     * @param {string} id Fullname of the post or comment
     * @returns {Promise}
     */
    TBApi.approveThing = id => TBApi.post('/api/approve', {
        id,
        uh: TBCore.modhash,
    });

    /**
     * Removes a post or comment.
     * @function
     * @param {string} id Fullname of the post or comment
     * @param {boolean?} spam If true, removes as spam
     * @returns {Promise}
     */
    TBApi.removeThing = (id, spam = false) => TBApi.post('/api/remove', {
        uh: TBCore.modhash,
        id,
        spam,
    });

    /**
     * Marks a post as NSFW.
     * @function
     * @param {string} id Fullname of the post
     * @returns {Promise}
     */
    TBApi.markOver18 = id => TBApi.post('/api/marknsfw', {
        id,
        uh: TBCore.modhash,
    });

    /**
     * Un-marks a post NSFW.
     * @function
     * @param {string} id Fullname of the post
     * @returns {Promise}
     */
    TBApi.unMarkOver18 = id => TBApi.post('/api/unmarknsfw', {
        uh: TBCore.modhash,
        id,
    });

    /**
     * Locks a post or comment.
     * @param {string} id The fullname of the submission or comment
     * @returns {Promise} Resolves to response data or rejects with a jqXHR
     */
    TBApi.lock = id => TBApi.post('/api/lock', {
        id,
        uh: TBCore.modhash,
    });

    /**
     * Unlocks a post or comment.
     * @param {string} id The fullname of the submission or comment
     * @returns {Promise} Resolves to response data or rejects with a jqXHR
     */
    TBApi.unlock = id => TBApi.post('/api/unlock', {
        uh: TBCore.modhash,
        id,
    });

    /**
     * Stickies a submission in a subreddit.
     * @param {string} id The fullname of the submission to sticky
     * @param {number} [num] The desired position of the sticky, either 1 or 2
     * @param {boolean} [state=true] Set to false to unsticky the thread (for
     * internal use only; use {@link TBApi~unstickyThread} instead)
     * @returns {Promise} Resolves with response data or rejects a jqXHR
     */
    TBApi.stickyThread = (id, num, state = true) => TBApi.post('/api/set_subreddit_sticky', {
        id,
        num,
        state,
        uh: TBCore.modhash,
    });

    /**
     * Unstickies a submission.
     * @param {string} id The fullname of the submission to sticky
     * @returns {Promise} Resolves with response data or rejects a jqXHR
     */
    TBApi.unstickyThread = id => TBApi.stickyThread(id, undefined, false);

    /**
     * Posts a comment.
     * @function
     * @param {string} parent The fullname of the parent submission or comment
     * @param {string} text The text of the comment to post
     * @returns {Promise} Resolves to a response or rejects with an error or array of errors
     */
    TBApi.postComment = async (parent, text) => {
        try {
            const response = await TBApi.post('/api/comment', {
                parent,
                uh: TBCore.modhash,
                text,
                api_type: 'json',
            });
            if (Object.prototype.hasOwnProperty.call(response.json, 'errors') && response.json.errors.length > 0) {
                logger.log(`Failed to post comment to on ${parent}`);
                logger.log(response.json.fails);
                throw response.json.errors;
            }
            logger.log(`Successfully posted comment on ${parent}`);
            return response;
        } catch (error) {
            logger.log(`Failed to post link to on ${parent}`);
            logger.log(error);
            throw error;
        }
    };

    /**
     * Posts a link submission in a subreddit.
     * @function
     * @param {string} link The URL to submit
     * @param {string} title The title of the submission
     * @param {string} subreddit The subreddit to submit to
     * @returns {Promise} Resolves to a response or rejects with an error or array of errors
     */
    TBApi.postLink = async (link, title, subreddit) => {
        try {
            const response = await TBApi.post('/api/submit', {
                kind: 'link',
                resubmit: 'true',
                url: link,
                uh: TBCore.modhash,
                title,
                sr: subreddit,
                sendreplies: 'true', // this is the default on reddit.com, so it should be our default.
                api_type: 'json',
            });
            if (Object.prototype.hasOwnProperty.call(response.json, 'errors') && response.json.errors.length > 0) {
                logger.log(`Failed to post link to /r/${subreddit}`);
                logger.log(response.json.errors);
                throw response.json.errors;
            }
            logger.log(`Successfully posted link to /r/${subreddit}`);
            return response;
        } catch (error) {
            logger.log(`Failed to post link to /r/${subreddit}`);
            logger.log(error);
            throw error;
        }
    };

    /**
     * Sends a private message to a user.
     * @function
     * @param {string} user The name of the user to send the message to
     * @param {string} subject The message's subject
     * @param {string} message The message's content
     * @param {?string} [subreddit] If provided, sends the message as a modmail
     * from the specified subreddit
     * @returns {Promise} Resolves to a response or rejects with an error or array of errors
     */
    TBApi.sendMessage = async (user, subject, message, subreddit) => {
        try {
            const response = await TBApi.post('/api/compose', {
                from_sr: subreddit,
                subject: subject.substr(0, 99),
                text: message,
                to: user,
                uh: TBCore.modhash,
                api_type: 'json',
            });
            if (Object.prototype.hasOwnProperty.call(response.json, 'errors') && response.json.errors.length > 0) {
                logger.log(`Failed to send link to /u/${user}`);
                logger.log(response.json.errors);
                throw response.json.errors;
            }
            logger.log(`Successfully send link to /u/${user}`);
            return response;
        } catch (error) {
            logger.log(`Failed to send link to /u/${user}`);
            logger.log(error);
            throw error;
        }
    };

    /**
     * Marks a message as read.
     * @param {string} id The fullname of the thing to mark as read
     * @returns {Promise}
     */
    TBApi.markMessageRead = id => TBApi.post('/api/read_message', {
        api_type: 'json',
        id,
        uh: TBCore.modhash,
    });

    /**
     * Gets information about a user.
     * @param {string} user The name of the user
     * @returns {Promise} Resolves to JSON user info or rejects with error text
     */
    TBApi.aboutUser = user => TBApi.getJSON(`/user/${user}/about.json`, {
        uh: TBCore.modhash,
    }).then(response => {
        TBStorage.purifyObject(response);
        return response;
    }).catch(error => {
        throw error.responseText;
    });

    /**
     * Gets the timestamp of the last public activity on the user's profile.
     * @param {string} user The user to look for
     * @returns {Promise} Resolves to a number or rejects an error string
     */
    TBApi.getLastActive = user => TBApi.getJSON(`/user/${user}.json?limit=1&sort=new`, {
        uh: TBCore.modhash,
    }).then(response => {
        TBStorage.purifyObject(response);
        return response.data.children[0].data.created_utc;
    }).catch(error => {
        throw error.responseText;
    });

    /**
     * Gets the rules for a subreddit
     * @param {string} subreddit The name of the subreddit
     * @returns {Promise} Resolves to the rules as JSON or rejects with an error string
     */
    TBApi.getRules = sub => TBApi.getJSON(`/r/${sub}/about/rules.json`, {
        uh: TBCore.modhash,
    }).then(response => {
        TBStorage.purifyObject(response);
        return response;
    }).catch(error => {
        throw error.responseText;
    });

    /**
     * Gets the report reasons for a post by its URL
     * @param {string} postURL The absolute URL of a post
     * @returns {Promise} Resolves to an object containing the reports or throws an error string
     */
    TBApi.getReportReasons = postURL => TBApi.getJSON(`${postURL}.json?limit=1`, {
        uh: TBCore.modhash,
    }).then(response => {
        TBStorage.purifyObject(response);
        if (typeof callback !== 'undefined') {
            const data = response[0].data.children[0].data;

            if (!data) {
                throw 'No reports returned';
            }

            return {
                user_reports: data.user_reports,
                mod_reports: data.mod_reports,
            };
        }
    }).catch(error => {
        throw error.responseText;
    });
})(window.TBApi = window.TBApi || {});
