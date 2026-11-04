/** lower case and without accents: "Conexão" matches "conexao" */
export const plain = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** whether any of the texts contains the search, ignoring case and accents (an empty search matches everything) */
export function matchesSearch(search: string, ...texts: string[]): boolean {
  const term = plain(search.trim());
  return !term || texts.some(text => plain(text).includes(term));
}
