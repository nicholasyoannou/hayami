import { fetchHayami } from '@/utils/hayamiApi';
import { con } from '@/utils/logger';
const log = con.m('RedditSearch');

export async function fetchAnimeMapperData(animeName: string): Promise<any | null> {
  try {
    const encodedName = encodeURIComponent(animeName);
    const response = await fetchHayami(`https://api.hayami.moe/anime/${encodedName}`);

    if (!response.ok) {
      log.log('Mapper service returned non-OK status:', response.status);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    log.log('Error fetching from mapper service:', error);
    return null;
  }
}
