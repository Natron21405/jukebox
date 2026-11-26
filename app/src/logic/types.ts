/** Song record as in app/public/songs.json (plan/06-song-data.md). */
export interface Song {
  id: string;
  title: string;
  /** Main artists. Any one is a correct guess. */
  artists: string[];
  /** Shown on reveal only; never accepted as a guess. */
  featuredArtists: string[];
  artistAliases?: string[];
  year: number;
  itunesTrackId?: number;
  previewUrl?: string;
  artworkUrl?: string;
}
