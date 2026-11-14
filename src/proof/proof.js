// Small helpers for the customer proof page. The page works without this script; it only adds the
// approve confirmation, the "check each item" lock and character counters.
(function () {
  var dialog = document.getElementById("pp-confirm");
  var pending = null;

  document.querySelectorAll("form[data-approve]").forEach(function (form) {
    var boxes = form.querySelectorAll("input[data-ack]");
    var button = form.querySelector("button[type=submit]");
    function sync() {
      var all = Array.prototype.every.call(boxes, function (b) { return b.checked; });
      if (button) button.disabled = boxes.length > 0 && !all;
    }
    boxes.forEach(function (b) { b.addEventListener("change", sync); });
    sync();
    form.addEventListener("submit", function (e) {
      if (form.dataset.confirmed === "1" || !dialog || typeof dialog.showModal !== "function") return;
      e.preventDefault();
      pending = form;
      dialog.showModal();
    });
  });

  if (dialog) {
    dialog.querySelector("[data-yes]").addEventListener("click", function () {
      if (!pending) return;
      pending.dataset.confirmed = "1";
      dialog.close();
      var btn = pending.querySelector("button[type=submit]");
      if (btn) btn.disabled = true;
      pending.submit();
    });
    dialog.querySelector("[data-no]").addEventListener("click", function () {
      pending = null;
      dialog.close();
    });
  }

  document.querySelectorAll("textarea[maxlength]").forEach(function (t) {
    var out = document.getElementById(t.id + "-count");
    if (!out) return;
    function update() { out.textContent = t.value.length + " / " + t.maxLength; }
    t.addEventListener("input", update);
    update();
  });

  // Stop double submits on slow connections.
  document.querySelectorAll("form[data-once]").forEach(function (form) {
    form.addEventListener("submit", function () {
      var btn = form.querySelector("button[type=submit]");
      if (btn) setTimeout(function () { btn.disabled = true; }, 0);
    });
  });
})();
