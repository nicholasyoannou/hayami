export type AnimeInfo = {
  animeName: string;
  episodeName: string;
  releaseDate?: string;
  malId?: number | null;
};

// Re-export all types from data.ts
export * from './types/data';
