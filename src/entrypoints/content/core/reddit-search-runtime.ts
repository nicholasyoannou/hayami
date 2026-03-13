import { fetchHayami } from '@/utils/hayamiApi';

export async function fetchAnimeMapperData(animeName: string): Promise<any | null> {
  try {
    const encodedName = encodeURIComponent(animeName);
    const response = await fetchHayami(`https://api.hayami.moe/anime/${encodedName}`);

    if (!response.ok) {
      console.log('Mapper service returned non-OK status:', response.status);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.log('Error fetching from mapper service:', error);
    return null;
  }
}
