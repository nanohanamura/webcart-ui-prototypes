((global) => {
  "use strict";

  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function katakanaToHiragana(value) {
    return value.replace(/[ァ-ヶ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60));
  }

  function normalizeSearchText(value) {
    return katakanaToHiragana(text(value).normalize("NFKC").toLocaleLowerCase("ja-JP"))
      .replace(/\s+/gu, "");
  }

  function normalizedValues(values) {
    return [...new Set(values.map(normalizeSearchText).filter(Boolean))];
  }

  function expandQuery(value, readingAliases = {}, synonyms = {}) {
    const needle = normalizeSearchText(value);
    if (!needle) return [];
    const expanded = [needle];
    const addAliases = (mapping, key) => {
      const aliases = mapping && Array.isArray(mapping[key]) ? mapping[key] : [];
      aliases.forEach((alias) => expanded.push(alias));
    };
    addAliases(readingAliases, needle);
    addAliases(synonyms, needle);
    normalizedValues(expanded).forEach((alias) => addAliases(synonyms, alias));
    return normalizedValues(expanded);
  }

  function usableIndex(searchIndex, snapshotId) {
    if (!searchIndex || searchIndex.schema_version !== 1 || !searchIndex.products) return false;
    return !snapshotId || searchIndex.snapshot_id === snapshotId;
  }

  function fallbackTerms(product) {
    return normalizedValues([
      product.SHOHINCD,
      product.SHOHINNM
    ]);
  }

  function productTerms(product, searchIndex, snapshotId) {
    if (!usableIndex(searchIndex, snapshotId)) return fallbackTerms(product);
    const entry = searchIndex.products[text(product.SHOHINCD)];
    return entry && Array.isArray(entry.terms) ? normalizedValues(entry.terms) : fallbackTerms(product);
  }

  function searchProducts(products, word, searchIndex = null, options = {}) {
    const validIndex = usableIndex(searchIndex, options.snapshotId);
    const needles = validIndex
      ? expandQuery(word, searchIndex.reading_aliases, searchIndex.synonyms)
      : normalizedValues([word]);
    if (!needles.length) return products.slice();
    return products
      .map((product, index) => {
        const code = normalizeSearchText(product.SHOHINCD);
        const name = normalizeSearchText(product.SHOHINNM);
        const terms = productTerms(product, searchIndex, options.snapshotId);
        let rank = 99;
        if (needles.includes(code)) rank = 0;
        else if (needles.some((needle) => code.startsWith(needle))) rank = 1;
        else if (needles.some((needle) => name.startsWith(needle))) rank = 2;
        else if (needles.some((needle) => terms.some((term) => term.startsWith(needle)))) rank = 3;
        else if (needles.some((needle) => terms.some((term) => term.includes(needle)))) rank = 4;
        return { product, index, rank };
      })
      .filter((entry) => entry.rank < 99)
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map((entry) => entry.product);
  }

  global.NANOHANA_SEARCH = {
    normalizeSearchText,
    expandQuery,
    searchProducts
  };
})(globalThis);
