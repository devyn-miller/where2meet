/** OpenStreetMap category ids as used by the openrouteservice POI API. */
export const PLACE_FILTERS = {
  coffee: { label: "Coffee", ids: [564] }, // cafe
  meal: { label: "Meal", ids: [570, 566, 567, 569, 563] }, // restaurant, fast food, food court, pub, biergarten
  outdoors: { label: "Outdoors", ids: [280, 272, 279, 332, 283] }, // park, garden, nature reserve, beach, playground
  anything: { label: "Anything", ids: [564, 570, 566, 567, 569, 563, 561, 568, 280, 272] },
} as const;
export type PlaceFilter = keyof typeof PLACE_FILTERS;

export function isPlaceFilter(x: unknown): x is PlaceFilter {
  return typeof x === "string" && x in PLACE_FILTERS;
}

export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  categories: string[];
  openingHours: string | null;
  distanceM: number;
}
