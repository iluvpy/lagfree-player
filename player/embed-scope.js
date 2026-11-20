/* Marks only LagFree's own embed document so embed.css can be scoped safely.
   Other websites' YouTube embeds never get the class and keep their UI. */
(() => {
  try {
    if (new URLSearchParams(location.search).get("lagfree") === "1") {
      document.documentElement.classList.add("lagfree-embed");
    }
  } catch {
    /* ignore */
  }
})();
