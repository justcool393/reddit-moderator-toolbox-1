function popcorn() {
    var self = new TB.Module('Popcorn');
    self.shortname = 'popcorn';

//Default settings
self.settings['enabled']['default'] = false;

self.register_setting('highlightAuto', {
    'type': 'boolean',
    'default': false,
    'title': 'Highlight comments automatically'
});

self.register_setting('negHighlightThreshold', {
    'type': 'number',
    'default': 0,
    'title': 'Negative comment highlight score threshold'
});

self.register_setting('expandOnLoad', {
    'type': 'boolean',
    'default': false,
    'title': 'Expand all downvoted/controversial comments on page load'
});

self.register_setting('sortOnMoreChildren', {
    'type': 'boolean',
    'default': false,
    'title': 'Continue to sort children on "load more comments"'
});

self.sorted = false;
self.pending = [];

self.init = function() {
    var neg_thresh = self.setting('negHighlightThreshold'),
        expand = self.setting('expandOnLoad'),
        auto = self.setting('highlightAuto'),
        sortOnMoreChildren = self.setting('sortOnMoreChildren'),
        $body = $('body'),
        $buttons = $('<div id="tb-popcorn-buttons">'),
        $init = $('<button id="tb-popcorn-init" class="tb-action-button">Trouble-seeker</button>').click(init),
        $sitetable;

    // if(!TBUtils.isMod) return;

    if($body.hasClass('listing-page')){
        $sitetable = $('.content > .sitetable');
    } else {
        $sitetable = $('.commentarea > .sitetable');
    }

    $sitetable.before($buttons);

    if(auto){
        init();
    } else {
        $buttons.append($init);
    }

    function init(){

        $init.remove();

        $body.addClass('tb-popcorn');

        if(!TBUtils.isCommentsPage) return;

        $buttons.append($('<button id="tb-popcorn-sort" class="tb-action-button">Sort</button>').click(sortChildren))
                .append($('<button class="tb-action-button" id="tb-popcorn-collapse">Collapse</button>').click(collapseNonDrama));

        $('.commentarea').on('click', '.morecomments', function(){
            if(sortOnMoreChildren) self.pending.push(sortMe.bind($(this).closest('.sitetable')));
        });

        window.addEventListener("TBNewThings", function () {
            run();
        });
        
        run();
    }


    function run(){

        highlightComments();

        if(expand) $('.thing:not(.tb-pc-proc).tb-drama, .thing:not(.tb-pc-proc).tb-ndrama').each(uncollapseThing);

        if(self.sorted) while(self.pending.length) self.pending.pop()();

        markProcessedThings();
    }

    function highlightComments(){

        $('.thing:not(.tb-pc-proc) .numchildren').each(numChildren);
        //Consider storing $('.thing:not(.tb-pc-proc)')
        $('.thing:not(.tb-pc-proc) .score.unvoted').each(score);

        $('.thing:not(.tb-pc-proc).controversial > .entry').addClass('tb-drama')
            .parents('.thing').addClass('tb-drama');
    }

    function score(){
        var $this = $(this),
            thing = $this.parents('.thing')[0];

        //highlighting here to avoid another .each() iteration
        if( (thing.dataset.score = $this.text().match(/^(-)?\d+/)[0]) <= neg_thresh ){
            $(thing).addClass('tb-neg tb-ndrama')
                .parents('.thing').addClass('tb-ndrama');
        }
    }

    function numChildren(){
        var $this = $(this);

        $this.parents('.thing')[0].dataset.nchildren = $this.text().match(/\d+/)[0];
    }

    function sortChildren(){

        self.sorted = true;

        $(this).closest('.sitetable, .commentarea, .content').find('.sitetable').each(sortMe);
    }

    function sortMe(){
        var $this = $(this),
            $things = $this.children('.thing:not(.morechildren)')
            .sort(function(a, b){
                return (b.dataset.nchildren - a.dataset.nchildren);
            }).each(sortMe);

        $this.prepend($things)
            .prepend($this.children('.thing.tb-drama'))
            .prepend($this.children('.thing.tb-ndrama'));
    }

    function collapseThing(){
        $(this).addClass('collapsed').find('.expand').eq(0).text('[+]');
    }

    function uncollapseThing(){
        $(this).removeClass('collapsed').find('.expand').eq(0).text('[–]');
    }

    function markProcessedThings(){
        $('.thing:not(.tb-pc-proc)').addClass('tb-pc-proc');
    }

    function collapseNonDrama(){

        $('.thing.tb-drama, .thing.tb-ndrama').each(uncollapseThing);

        $('.commentarea > .sitetable > .thing:not(.tb-drama, .tb-ndrama), .thing.tb-drama > .child > .sitetable > .thing:not(.tb-drama, .tb-ndrama), .thing.tb-ndrama > .child > .sitetable > .thing:not(.tb-drama, .tb-ndrama)')
            .each(collapseThing);//collapsing only top-level-most comment children of drama
    }
/*  TODO

    Include below threshold comments when the score is hidden?

    Build a filter for collections so elements can remove themselves if they don't need being "dealt with"

    Calculate %upvoted to get real numbers.

    */
};

TB.register_module(self);
}

(function() {
    window.addEventListener("TBModuleLoaded", function () {
        popcorn(); //run
    });
})();