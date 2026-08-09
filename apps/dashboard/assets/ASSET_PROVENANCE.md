# Sentinel dashboard asset provenance

These assets are pinned, local browser-runtime copies reviewed for the Sentinel dashboard. The browser does not load the video, poster, or fonts from a third-party origin.

## Network video and poster

- Creator: Pressmaster
- Source page: https://www.pexels.com/video/digital-projection-of-neon-abstract-geometrical-line-of-a-communication-network-3129540/
- License: https://www.pexels.com/license/
- Video source: https://videos.pexels.com/video-files/3129540/3129540-hd_1280_720_30fps.mp4
- Local file: `sentinel-network-loop.mp4`
- SHA-256: `547fddfb71d644a47c9e268868ff557eae8ad8934a2b0b7b445f2c765e4709a4`
- Poster source: https://images.pexels.com/videos/3129540/free-video-3129540.jpg?auto=compress&cs=tinysrgb&w=1600
- Local file: `sentinel-network-poster.jpg`
- SHA-256: `1c7db6b9ca74d9017faad3e989539a44c5a0d6b680ad3d20ad6d62974557d3f3`

## Fonts

The Google Fonts CSS request supplied by the user was:

`https://fonts.googleapis.com/css2?family=Special+Elite&family=Geist:wght@400;500;600;700&display=swap`

- Geist source: https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwcGFWNOITd.woff2
- Local file: `geist-latin.woff2`
- SHA-256: `9b6f5ff45b278c744b5f379a2c4ecbaf858a842b8eaf82ac8d21b699ca16c608`
- Special Elite source: https://fonts.gstatic.com/s/specialelite/v20/XLYgIZbkc4JPUL5CVArUVL0ntnAOSFNuQsI.woff2
- Local file: `special-elite-latin.woff2`
- SHA-256: `3cf06771841c778db94dfc003a9239338613c07a9e8c8125d0641a1ba6e7977a`

At browser runtime, Sentinel serves and uses these local copies only.
