// 註冊 service worker（sw.js）：之後每次開網站都拿最新版檔案；第一次啟用時自動重新載入一次
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    try {
      if (hadController || sessionStorage.getItem("swReloaded")) return;
      sessionStorage.setItem("swReloaded", "1");
    } catch { return; }
    location.reload();
  });
}
