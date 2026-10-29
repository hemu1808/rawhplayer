# RawhPlayer privacy information

Updated October 28, 2026. This describes the implementation branch; deployed releases may differ.

## Local data

The native app stores music metadata, absolute file paths, favorites, play counts, listening time, queues, playlists, watched-folder settings and selected-path grants in SQLite. Artwork, waveform data and metadata-edit recovery copies are stored in the application's data directory. Audio remains in its original location unless you explicitly edit its metadata.

Theme, playback preferences, EQ/volume profiles keyed by output-device name and some listening statistics use webview localStorage. Local queue suggestions use favorites, play counts, artist and genre without a network request. The previous browser library is retained after migration for recovery. Clearing localStorage does not delete the native database or credentials.

Integration keys use the operating system credential store. The webview can save/delete a key and query its presence, but cannot retrieve a stored key through the app's IPC commands. Saving or deleting the Gemini key also removes the old localStorage key.

## Network access

Pressing the optional Gemini insight button sends the track title and artist, together with your API key, to Google. No audio is uploaded for this feature. Google's privacy terms apply.

Provider playback is absent from navigation. A native YouTube metadata-search command remains; invoking it sends a query and configured key to Google. It does not provide playable media.

Remote artwork URLs in restored metadata can contact their hosts when displayed. Imported local artwork is cached on-device. Fonts are bundled and lyrics use local LRC/TXT files.

In signed release builds, Check for updates contacts the configured GitHub endpoint. Downloads may contact GitHub's asset-delivery hosts. Those hosts receive ordinary connection information, including your IP address. Updates are not checked or installed automatically. Administrators can disable the updater at process launch with `RAWH_DISABLE_UPDATES=1`.

No analytics, advertising, account service or automatic diagnostic upload is implemented.

## Export and deletion

Library backups contain paths and listening metadata. Diagnostics contain app version, OS, architecture, output format, underrun/clipping counts, normalization mode and administrator policy. They omit track paths, device names, arbitrary error text and credentials. Diagnostics are exported only on request and are not automatically uploaded.

Removing a library track does not delete its audio. Removing a watched folder stops monitoring but does not delete tracks or revoke earlier path grants. Metadata edits retain recovery copies. Uninstallers may leave application data and credential-store entries behind. Use Delete key in Settings to remove an integration credential.

To remove local data, close the player and remove its application-data directory and webview storage after backing up wanted playlists. Credential-store entries require separate removal. Do not remove your music folders.

Privacy questions can be filed in the project's GitHub issue tracker. Avoid posting private paths, API keys or library exports publicly.
