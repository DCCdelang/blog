// One AudioContext for the whole page, shared by the soundboard and the bass
// panel. Browsers only allow a handful of contexts per page, and each one costs
// an audio thread, so we never make more than this single one.
window.SharedAudio = (function () {
    var ctx = null;

    return {
        // Created on the first call rather than at load time: a context started
        // without a user gesture is blocked by the browser's autoplay policy.
        get: function () {
            if (ctx === null) {
                ctx = new (window.AudioContext || window.webkitAudioContext)();
            }
            // A context gets suspended when the tab goes to the background.
            if (ctx.state === "suspended") {
                ctx.resume();
            }
            return ctx;
        }
    };
})();
