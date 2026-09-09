/** Prepare the image before this dialog so native sharing runs directly on a tap. */
export const showImageSaveDialog = (file: File): void => {
  const dialog = document.createElement("dialog");
  dialog.className = "phone-image-dialog";
  dialog.setAttribute("aria-labelledby", "phone-image-title");
  dialog.innerHTML = `
    <h2 id="phone-image-title">画像を保存</h2>
    <img alt="投稿の記念画像" />
    <p class="phone-image-hint"></p>
    <div class="phone-image-dialog-actions">
      <button type="button" class="phone-action-button phone-image-share">写真に保存・共有</button>
      <a class="phone-action-button phone-image-download">ダウンロード</a>
      <button type="button" class="phone-action-button phone-image-close">閉じる</button>
    </div>
    <p class="phone-error" role="status"></p>
  `;
  const image = dialog.querySelector<HTMLImageElement>("img")!;
  const share = dialog.querySelector<HTMLButtonElement>(".phone-image-share")!;
  const download = dialog.querySelector<HTMLAnchorElement>(".phone-image-download")!;
  const hint = dialog.querySelector<HTMLParagraphElement>(".phone-image-hint")!;
  const error = dialog.querySelector<HTMLParagraphElement>(".phone-error")!;
  const url = URL.createObjectURL(file);
  image.src = url;
  download.href = url;
  download.download = file.name;
  let canShare = false;
  try {
    canShare =
      typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }) === true;
  } catch {
    /* Use the download option. */
  }
  share.hidden = !canShare;
  hint.textContent = canShare
    ? "共有メニューの「画像を保存」などから写真に保存できます。表示される項目は端末によって異なります。"
    : "画像を長押しして保存するか、ダウンロードしてください。";
  share.addEventListener("click", async () => {
    share.disabled = true;
    error.textContent = "";
    try {
      await navigator.share({ files: [file] });
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        error.textContent = "共有を開けませんでした。画像の長押しかダウンロードをお試しください。";
      }
    } finally {
      share.disabled = false;
    }
  });
  dialog
    .querySelector<HTMLButtonElement>(".phone-image-close")!
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      // Allow an initiated Safari download to consume the URL before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    { once: true },
  );
  document.body.appendChild(dialog);
  dialog.showModal();
};
