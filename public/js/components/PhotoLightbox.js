(function() {
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  const PhotoLightbox = {
    _onKeyDown: null,

    open(url, alt) {
      this.close();

      const lb = document.createElement("div");
      lb.id = "photo-lightbox";
      lb.className = "pl-lightbox";
      lb.innerHTML =
        '<div class="pl-overlay"></div>' +
        '<div class="pl-content">' +
          '<button class="pl-close" title="关闭">&times;</button>' +
          '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt || "") + '">' +
          '<div class="pl-caption">' + escapeHtml(alt || "") + '</div>' +
          '<div class="pl-fallback" style="display:none;"><span>图片加载失败，请检查链接是否有效</span></div>' +
        '</div>';
      document.body.appendChild(lb);

      const overlay = lb.querySelector(".pl-overlay");
      const closeBtn = lb.querySelector(".pl-close");
      const img = lb.querySelector("img");
      const fallback = lb.querySelector(".pl-fallback");
      const caption = lb.querySelector(".pl-caption");

      overlay.onclick = function() { PhotoLightbox.close(); };
      closeBtn.onclick = function() { PhotoLightbox.close(); };

      img.onerror = function() {
        this.style.display = "none";
        if (caption) caption.style.display = "none";
        fallback.style.display = "flex";
      };

      this._onKeyDown = function(e) {
        if (e.key === "Escape") PhotoLightbox.close();
      };
      document.addEventListener("keydown", this._onKeyDown);
    },

    close() {
      const lb = document.getElementById("photo-lightbox");
      if (lb) lb.remove();
      if (this._onKeyDown) {
        document.removeEventListener("keydown", this._onKeyDown);
        this._onKeyDown = null;
      }
    }
  };

  window.PhotoLightbox = PhotoLightbox;
})();
