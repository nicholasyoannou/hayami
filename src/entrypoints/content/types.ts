export type AnimeInfo = {
  animeName: string;
  episodeName: string;
  releaseDate?: string;
  malId?: number | null;
  anilistId?: number | null;
};

// Re-export all types from data.ts
export * from './types/data';
