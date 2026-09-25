(() => {
  const input = document.getElementById('design-search');
  const noResults = document.getElementById('no-results');
  const normalize = (value) => String(value || '').toLocaleLowerCase('ja').normalize('NFKC');
  input?.addEventListener('input', () => {
    const query = normalize(input.value.trim());
    let shown = 0;
    document.querySelectorAll('.searchable').forEach((section) => {
      const matched = !query || normalize(`${section.dataset.search || ''} ${section.textContent}`).includes(query);
      section.hidden = !matched;
      if (matched) shown += 1;
    });
    noResults.hidden = shown !== 0;
  });
  document.getElementById('print-design')?.addEventListener('click', () => window.print());
  document.querySelectorAll('.toc a').forEach((link) => link.addEventListener('click', () => {
    if (window.innerWidth <= 820) document.querySelector('.toc')?.classList.remove('is-open');
  }));
})();
