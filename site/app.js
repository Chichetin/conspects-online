// Формулы, кнопка оглавления на узких экранах и подсветка текущего раздела.

document.querySelectorAll(".math").forEach((el) => {
  katex.render(el.textContent, el, {
    displayMode: el.classList.contains("display"),
    throwOnError: false,
  });
});

const toc = document.getElementById("toc");
const button = document.getElementById("toc-button");

function setOpen(open) {
  toc.classList.toggle("open", open);
  button.setAttribute("aria-expanded", String(open));
}

button.addEventListener("click", (e) => {
  e.stopPropagation();
  setOpen(!toc.classList.contains("open"));
});
toc.addEventListener("click", (e) => {
  if (e.target.closest("a")) setOpen(false);
});
document.addEventListener("click", (e) => {
  if (toc.classList.contains("open") && !toc.contains(e.target)) setOpen(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setOpen(false);
});

const links = new Map(
  [...toc.querySelectorAll("a[href^='#']")].map((a) => [decodeURIComponent(a.hash.slice(1)), a]),
);
const sections = [...document.querySelectorAll("main section.level2")].filter((s) => links.has(s.id));

function updateActive() {
  let current = sections[0];
  for (const s of sections) {
    if (s.getBoundingClientRect().top < window.innerHeight * 0.3) current = s;
  }
  links.forEach((a) => a.classList.remove("active"));
  if (current) links.get(current.id).classList.add("active");
}

window.addEventListener("scroll", updateActive, { passive: true });
updateActive();
