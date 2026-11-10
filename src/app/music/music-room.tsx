"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Disc3,
  Headphones,
  ListMusic,
  Pause,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import styles from "./music.module.css";

type Track = {
  id: string;
  title: string;
  artist: string;
  anime: string;
  episode: string;
  duration: string;
  videoId: string;
  sourceName: string;
  color: string;
  coverMark: string;
};

type YouTubePlayer = {
  cueVideoById: (videoId: string) => void;
  destroy: () => void;
  getIframe: () => HTMLIFrameElement;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getVolume: () => number;
  loadVideoById: (videoId: string) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
};

type YouTubePlayerEvent = { target: YouTubePlayer; data: number };
type YouTubePlayerOptions = {
  height: string;
  width: string;
  videoId: string;
  host?: string;
  playerVars?: Record<string, number | string>;
  events: {
    onReady: (event: YouTubePlayerEvent) => void;
    onStateChange: (event: YouTubePlayerEvent) => void;
    onError: () => void;
  };
};

type YouTubeApi = {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number };
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const TRACKS: Track[] = [
  {
    id: "mixed-nuts",
    title: "Mixed Nuts",
    artist: "Official HIGE DANdism",
    anime: "SPY×FAMILY",
    episode: "Opening 01",
    duration: "03:34",
    videoId: "CbH2F0kXgTY",
    sourceName: "Official HIGE DANdism · Official Video",
    color: "#d7f44a",
    coverMark: "MIXED\nNUTS",
  },
  {
    id: "idol",
    title: "Idol",
    artist: "YOASOBI",
    anime: "OSHI NO KO",
    episode: "Opening 01",
    duration: "03:33",
    videoId: "ZRtdQ81jPUQ",
    sourceName: "YOASOBI · Official Music Video",
    color: "#ff5b87",
    coverMark: "IDOL",
  },
  {
    id: "kick-back",
    title: "KICK BACK",
    artist: "Kenshi Yonezu",
    anime: "Chainsaw Man",
    episode: "Opening 01",
    duration: "03:13",
    videoId: "M2cckDmNLMI",
    sourceName: "Kenshi Yonezu · Official Video",
    color: "#e96544",
    coverMark: "KICK\nBACK",
  },
];

let youtubeApiPromise: Promise<YouTubeApi> | undefined;

function loadYouTubeApi() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("The video player is only available in a browser."));
  }
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube’s player could not be initialized."));
    };

    const script = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (!script) {
      const newScript = document.createElement("script");
      newScript.src = "https://www.youtube.com/iframe_api";
      newScript.async = true;
      newScript.onerror = () => reject(new Error("YouTube’s player could not be loaded."));
      document.head.appendChild(newScript);
    }
  }).catch((error: unknown) => {
    youtubeApiPromise = undefined;
    throw error;
  });

  return youtubeApiPromise;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export default function MusicRoom() {
  const [selectedTrack, setSelectedTrack] = useState(TRACKS[0]);
  const [query, setQuery] = useState("");
  const [playerReady, setPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState(false);
  const [playbackState, setPlaybackState] = useState<"loading" | "ready" | "playing" | "paused" | "ended">("loading");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(70);
  const playerElementRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const initialTrack = useRef(TRACKS[0]);
  const selectedTrackRef = useRef(selectedTrack);

  const filteredTracks = TRACKS.filter((track) =>
    `${track.title} ${track.artist} ${track.anime}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const activeIndex = TRACKS.findIndex((track) => track.id === selectedTrack.id);

  useEffect(() => {
    let disposed = false;
    let player: YouTubePlayer | undefined;

    loadYouTubeApi()
      .then((api) => {
        if (disposed || !playerElementRef.current) return;
        player = new api.Player(playerElementRef.current, {
          width: "100%",
          height: "100%",
          videoId: initialTrack.current.videoId,
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            autoplay: 0,
            controls: 1,
            enablejsapi: 1,
            fs: 1,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              if (disposed) return;
              playerRef.current = event.target;
              const readyTrack = selectedTrackRef.current;
              event.target.getIframe().title = `Official YouTube player: ${readyTrack.title}`;
              if (readyTrack.id !== initialTrack.current.id) event.target.cueVideoById(readyTrack.videoId);
              setPlayerReady(true);
              setPlaybackState("ready");
              setDuration(event.target.getDuration() || 0);
              setVolume(event.target.getVolume());
            },
            onStateChange: (event) => {
              if (disposed) return;
              const state = api.PlayerState;
              if (event.data === state.PLAYING) setPlaybackState("playing");
              else if (event.data === state.PAUSED) setPlaybackState("paused");
              else if (event.data === state.BUFFERING) setPlaybackState("loading");
              else if (event.data === state.ENDED) setPlaybackState("ended");
              else setPlaybackState("ready");
              setDuration(event.target.getDuration() || 0);
            },
            onError: () => {
              if (!disposed) setPlayerError(true);
            },
          },
        });
      })
      .catch(() => {
        if (!disposed) setPlayerError(true);
      });

    return () => {
      disposed = true;
      playerRef.current = null;
      player?.destroy();
    };
  }, []);

  useEffect(() => {
    if (!playerReady || playbackState !== "playing") return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      setCurrentTime(player.getCurrentTime() || 0);
      setDuration(player.getDuration() || 0);
    }, 500);
    return () => window.clearInterval(timer);
  }, [playerReady, playbackState]);

  const selectTrack = useCallback((track: Track) => {
    if (track.id === selectedTrack.id) {
      if (playbackState === "playing") playerRef.current?.pauseVideo();
      else playerRef.current?.playVideo();
      return;
    }
    selectedTrackRef.current = track;
    setSelectedTrack(track);
    setCurrentTime(0);
    setDuration(0);
    setPlayerError(false);
    playerRef.current?.loadVideoById(track.videoId);
    const iframe = playerRef.current?.getIframe();
    if (iframe) iframe.title = `Official YouTube player: ${track.title}`;
  }, [playbackState, selectedTrack.id]);

  const changeTrack = useCallback((offset: number) => {
    const nextIndex = (activeIndex + offset + TRACKS.length) % TRACKS.length;
    selectTrack(TRACKS[nextIndex]);
  }, [activeIndex, selectTrack]);

  const togglePlayback = () => {
    const player = playerRef.current;
    if (!playerReady || !player) return;
    if (playbackState === "playing") player.pauseVideo();
    else player.playVideo();
  };

  const seek = (value: number) => {
    const player = playerRef.current;
    if (!player || !duration) return;
    player.seekTo(value, true);
    setCurrentTime(value);
  };

  const adjustVolume = (value: number) => {
    setVolume(value);
    playerRef.current?.setVolume(value);
  };

  const activeTrackUrl = `https://www.youtube.com/watch?v=${selectedTrack.videoId}`;
  const statusLabel = playerError
    ? "Open the official source to listen"
    : playbackState === "playing"
      ? "Playing from official source"
      : playbackState === "loading"
        ? "Connecting to official source"
        : "Official source ready";

  return (
    <main className={styles.page}>
      <div aria-hidden="true" className={styles.ambient} />
      <div className={styles.frame}>
        <header className={styles.header}>
          <a className={styles.wordmark} href="/music" aria-label="Senko Music home">
            <span className={styles.brandIcon}><Disc3 size={18} strokeWidth={1.7} /></span>
            <span>SENKO<span className={styles.brandSlash}>/</span>SIDE A</span>
          </a>
          <nav aria-label="Music navigation" className={styles.nav}>
            <a className={styles.navActive} href="#playlist"><ListMusic size={14} /> THE ROTATION</a>
            <span className={styles.navDivider} />
            <span className={styles.navNote}>A LISTENING ROOM FOR OPENINGS</span>
          </nav>
          <label className={styles.searchBox}>
            <Search size={16} aria-hidden="true" />
            <span className={styles.visuallyHidden}>Search songs, artists, or anime</span>
            <input
              aria-label="Search songs, artists, or anime"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a track..."
              type="search"
              value={query}
            />
            {query && (
              <button aria-label="Clear search" className={styles.clearSearch} onClick={() => setQuery("")} type="button">
                <X size={14} />
              </button>
            )}
            <kbd>/</kbd>
          </label>
        </header>

        <section aria-labelledby="room-title" className={styles.intro}>
          <div>
            <p className={styles.overline}><span className={styles.liveDot} /> OPEN LATE · TOKYO / 23:41</p>
            <h1 id="room-title">The opening<br /><em>never ends.</em></h1>
          </div>
          <div className={styles.introAside}>
            <p>Soundtrack the scene you’re in.</p>
            <span>CURATED ANIME OPENINGS <b>—</b> VOL. 01</span>
          </div>
        </section>

        <section aria-label={`Now playing ${selectedTrack.title}`} className={styles.feature}>
          <div className={styles.coverPanel}>
            <div className={styles.coverTopline}>
              <span>NOW SPINNING</span>
              <span>NO. {String(activeIndex + 1).padStart(3, "0")} <span className={styles.coverDiamond}>◆</span></span>
            </div>
            <div className={styles.coverArt} style={{ "--cover-accent": selectedTrack.color } as React.CSSProperties & { "--cover-accent": string }}>
              <div aria-hidden="true" className={styles.coverOrbit} />
              <div aria-hidden="true" className={styles.coverDisc}>
                <span className={styles.discHole} />
              </div>
              <div className={styles.coverStamp}>SENKO<br />SOUND<br /><small>ORIGINAL CUTS</small></div>
              <p className={styles.coverTitle}>{selectedTrack.coverMark.split("\n").map((line) => <span key={line}>{line}</span>)}</p>
              <span className={styles.coverAnime}>{selectedTrack.anime} / {selectedTrack.episode}</span>
              <span className={styles.coverIssue}>SIDE A · 2026</span>
            </div>
            <div className={styles.coverCaption}><span>THE ANIME MIX / 01</span><span>✳︎ 33⅓ RPM</span></div>
          </div>

          <div className={styles.trackDetails}>
            <div className={styles.trackEyebrow}><Headphones size={14} /> FEATURED CUT <span>{String(activeIndex + 1).padStart(2, "0")} / {String(TRACKS.length).padStart(2, "0")}</span></div>
            <h2>{selectedTrack.title}</h2>
            <p className={styles.artist}>{selectedTrack.artist}</p>
            <div className={styles.animeTag}><span>FROM THE SERIES</span><b>{selectedTrack.anime}</b></div>
            <p className={styles.trackNote}>A little chaos, a little heart — the perfect first scene.</p>
            <div className={styles.detailRule} />
            <div className={styles.sourceRow}>
              <span className={styles.sourceMark}><span>▶</span></span>
              <span><b>OFFICIAL VIDEO</b><small>{selectedTrack.sourceName}</small></span>
              <span className={styles.trackLength}>{selectedTrack.duration}</span>
            </div>
            <a className={styles.watchLink} href={activeTrackUrl} rel="noreferrer" target="_blank">
              WATCH ON YOUTUBE <ArrowUpRight size={14} />
            </a>
          </div>

          <div className={styles.playerPanel}>
            <div className={styles.playerHead}>
              <span>OFFICIAL SOURCE PLAYER</span>
              <span className={styles.playerSecure}><span /> YOUTUBE</span>
            </div>
            <div className={styles.videoFrame}>
              <div className={styles.videoTarget} ref={playerElementRef} />
              {!playerReady && !playerError && (
                <div className={styles.playerOverlay} aria-live="polite">
                  <span className={styles.spinner} />
                  <span>CONNECTING TO OFFICIAL SOURCE</span>
                </div>
              )}
              {playerError && (
                <div className={styles.playerError} role="status">
                  <span>THE EMBED IS UNAVAILABLE HERE.</span>
                  <a href={activeTrackUrl} rel="noreferrer" target="_blank">OPEN OFFICIAL VIDEO <ArrowUpRight size={14} /></a>
                </div>
              )}
            </div>
            <div className={styles.playerFoot}><span>{statusLabel}</span><span>PRIVACY-ENHANCED EMBED</span></div>
          </div>
        </section>

        <section aria-labelledby="playlist-title" className={styles.playlist} id="playlist">
          <div className={styles.playlistHeader}>
            <div>
              <p className={styles.overline}>PICK YOUR OPENING</p>
              <h2 id="playlist-title">The rotation<span> ({filteredTracks.length.toString().padStart(2, "0")})</span></h2>
            </div>
            <div className={styles.listLegend}><span className={styles.legendDot} /> OFFICIAL VIDEO SOURCES ONLY</div>
          </div>

          <div className={styles.tableHead} aria-hidden="true">
            <span>#</span><span>TRACK / ARTIST</span><span>SERIES</span><span>SOURCE</span><span>TIME</span>
          </div>
          {filteredTracks.length ? (
            <ol className={styles.trackList}>
              {filteredTracks.map((track) => {
                const isSelected = selectedTrack.id === track.id;
                return (
                  <li className={`${styles.trackRow} ${isSelected ? styles.selected : ""}`} key={track.id}>
                    <button
                      aria-current={isSelected ? "true" : undefined}
                      aria-label={`${isSelected && playbackState === "playing" ? "Pause" : "Play"} ${track.title} by ${track.artist}`}
                      className={styles.trackSelect}
                      onClick={() => selectTrack(track)}
                      type="button"
                    >
                      <span className={styles.trackNumber}>
                        {isSelected && playbackState === "playing" ? <span className={styles.equalizer}><i /><i /><i /></span> : String(TRACKS.indexOf(track) + 1).padStart(2, "0")}
                      </span>
                      <span className={styles.trackMain}><b>{track.title}</b><small>{track.artist}</small></span>
                      <span className={styles.trackAnime}>{track.anime}<small>{track.episode}</small></span>
                      <span className={styles.trackSource}><span>▶</span> OFFICIAL</span>
                      <span className={styles.rowDuration}>{track.duration}</span>
                      <span className={styles.rowAction} aria-hidden="true">{isSelected && playbackState === "playing" ? <Pause size={15} /> : <Play size={15} />}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className={styles.emptyState} role="status">
              <Search size={18} />
              <b>No tracks in this scene.</b>
              <span>Try a song, artist, or anime title.</span>
              <button onClick={() => setQuery("")} type="button">CLEAR SEARCH</button>
            </div>
          )}
        </section>

        <footer className={styles.footer}>
          <span>SENKO / AFTER HOURS <span>·</span> OPENINGS THAT STAY WITH YOU</span>
          <span>ALL AUDIO VIA OFFICIAL YOUTUBE EMBEDS</span>
        </footer>
      </div>

      <aside aria-label="Playback controls" className={styles.dock}>
        <div className={styles.dockTrack}>
          <div className={styles.miniArt} style={{ "--cover-accent": selectedTrack.color } as React.CSSProperties & { "--cover-accent": string }}><Disc3 size={18} /></div>
          <span><b>{selectedTrack.title}</b><small>{selectedTrack.artist}</small></span>
        </div>
        <div className={styles.dockControls}>
          <div className={styles.transport}>
            <button aria-label="Previous track" disabled={!playerReady} onClick={() => changeTrack(-1)} type="button"><SkipBack size={17} fill="currentColor" /></button>
            <button
              aria-label={playbackState === "playing" ? "Pause official video" : "Play official video"}
              className={styles.playButton}
              disabled={!playerReady || playerError}
              onClick={togglePlayback}
              type="button"
            >
              {playbackState === "playing" ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
            </button>
            <button aria-label="Next track" disabled={!playerReady} onClick={() => changeTrack(1)} type="button"><SkipForward size={17} fill="currentColor" /></button>
          </div>
          <div className={styles.seekControl}>
            <span>{formatTime(currentTime)}</span>
            <input
              aria-label="Seek in current video"
              disabled={!playerReady || !duration}
              max={duration || 0}
              min="0"
              onChange={(event) => seek(Number(event.target.value))}
              type="range"
              value={Math.min(currentTime, duration || 0)}
            />
            <span>{formatTime(duration)}</span>
          </div>
        </div>
        <div className={styles.volumeControl}>
          <button aria-label={volume === 0 ? "Unmute video" : "Mute video"} disabled={!playerReady} onClick={() => adjustVolume(volume === 0 ? 70 : 0)} type="button">
            {volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <input
            aria-label="Video volume"
            disabled={!playerReady}
            max="100"
            min="0"
            onChange={(event) => adjustVolume(Number(event.target.value))}
            type="range"
            value={volume}
          />
        </div>
      </aside>
    </main>
  );
}
