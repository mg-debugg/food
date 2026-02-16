export type NaverLocalItem = {
  title: string;
  link: string;
  category: string;
  description: string;
  telephone: string;
  address: string;
  roadAddress: string;
  mapx: string;
  mapy: string;
};

export type PlaceMeta = {
  saved: boolean;
  revisitCount: number;
  tags: string[];
  memo: string;
  updatedAt: number;
};

