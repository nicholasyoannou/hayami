export async function fetchHayami(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init)
}
