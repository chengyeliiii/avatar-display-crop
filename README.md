# Avatar Display Crop

SillyTavern third-party extension that stores avatar display crop settings separately from the character card image.

## Intended behavior

- The uploaded character avatar remains the original image for character-card export.
- A crop can be selected for the character editor preview.
- The crop parameters are saved under `data.extensions.avatar_display_crop`.
- The `裁剪显示` button opens the crop dialog for the current avatar.

## Installation

Install this repository as a third-party extension from the SillyTavern Extensions panel, or copy the repository folder to:

```text
public/scripts/extensions/third-party/avatar-display-crop
```

## Current scope

This initial version targets the character editor preview and upload flow. Full application of the saved crop to every avatar rendered in chat and character lists requires a shared avatar-rendering hook in the SillyTavern version being used.
