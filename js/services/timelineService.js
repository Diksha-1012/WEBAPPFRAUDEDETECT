/* TRACE service — Timeline builder.
   Orders events by real date+time when present, then by time-of-day when only a
   clock time was visible, and finally groups untimed events. Dates are never invented. */
window.TRACE_SERVICES = window.TRACE_SERVICES || {};
(function () {
  'use strict';

  function rank(r) {
    if (r.timestamp) return [0, new Date(r.timestamp).getTime()];
    if (r.timeMinutes != null) return [1, r.timeMinutes];
    return [2, 0];
  }

  function sortEvents(records) {
    return (records || []).slice().sort(function (a, b) {
      var ra = rank(a), rb = rank(b);
      return (ra[0] - rb[0]) || (ra[1] - rb[1]);
    });
  }

  function build(records) {
    var placed = [], unplaced = [];
    (records || []).forEach(function (r) {
      ((r.timestamp || r.timeMinutes != null) ? placed : unplaced).push(r);
    });
    return { events: sortEvents(placed), unplaced: unplaced };
  }

  window.TRACE_SERVICES.timeline = {
    sortEvents: sortEvents,
    build: build,
    TimelineBuilder: { sortEvents: sortEvents, build: build }
  };
})();
