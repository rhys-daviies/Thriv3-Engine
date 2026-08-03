export const SPORTS = [
  { id: 'mens-soccer', label: "Men's Soccer" },
  { id: 'womens-soccer', label: "Women's Soccer" },
  { id: 'womens-field-hockey', label: "Women's Field Hockey" },
  { id: 'mens-ice-hockey', label: "Men's Ice Hockey" },
  { id: 'mens-volleyball', label: "Men's Volleyball" },
  { id: 'womens-volleyball', label: "Women's Volleyball" },
];

export function sportLabel(id) {
  return SPORTS.find((s) => s.id === id)?.label || id;
}
