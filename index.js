import { characters, createOrEditCharacter, eventSource, event_types, getThumbnailUrl } from '../../../../script.js';
import { extension_settings, writeExtensionField, UNSET_VALUE } from '../../../../scripts/extensions.js';
import { Popup, POPUP_TYPE } from '../../../../scripts/popup.js';
import { getBase64Async } from '../../../../scripts/utils.js';

const EXTENSION_KEY = 'avatar_display_crop';
const BUTTON_ID = 'avatar_display_crop_button';

let currentCrop = null;
let currentAvatar = null;

function getCharacterCrop(character) {
    return character?.data?.extensions?.[EXTENSION_KEY]?.crop ?? null;
}

function getCurrentCharacter() {
    const characterId = Number(document.getElementById(BUTTON_ID)?.dataset.characterId);
    return Number.isInteger(characterId) && characterId >= 0 ? characters[characterId] : null;
}

function getAvatarSource(character) {
    if (!character?.avatar || character.avatar === 'none') return '';
    return `/characters/${encodeURIComponent(character.avatar)}`;
}

function applyPreviewCrop(image, crop) {
    if (!image || !crop) {
        image?.style.removeProperty('object-position');
        image?.style.removeProperty('object-fit');
        return;
    }

    const sourceWidth = Number(crop.sourceWidth) || Number(crop.width);
    const sourceHeight = Number(crop.sourceHeight) || Number(crop.height);
    const cropWidth = Number(crop.width);
    const cropHeight = Number(crop.height);

    if (!sourceWidth || !sourceHeight || !cropWidth || !cropHeight) return;

    // object-position is based on the overflow created by object-fit: cover.
    // Calculate that overflow from the actual preview box, then center the
    // selected crop inside the visible area. This keeps right-side crops stable.
    const boxRatio = image.clientWidth && image.clientHeight
        ? image.clientWidth / image.clientHeight
        : 2 / 3;
    const coverWidth = Math.max(sourceWidth, sourceHeight * boxRatio);
    const coverHeight = Math.max(sourceHeight, sourceWidth / boxRatio);
    const xRange = Math.max(0, coverWidth - sourceWidth);
    const yRange = Math.max(0, coverHeight - sourceHeight);
    const centerX = Number(crop.x) + cropWidth / 2;
    const centerY = Number(crop.y) + cropHeight / 2;
    const viewportWidth = sourceWidth - xRange;
    const viewportHeight = sourceHeight - yRange;
    const x = xRange ? Math.max(0, Math.min(100, ((centerX - viewportWidth / 2) / xRange) * 100)) : 50;
    const y = yRange ? Math.max(0, Math.min(100, ((centerY - viewportHeight / 2) / yRange) * 100)) : 50;
    image.style.objectFit = 'cover';
    image.style.objectPosition = `${x}% ${y}%`;
}

function updateEditorPreview(character = getCurrentCharacter()) {
    const image = document.querySelector('#avatar_load_preview');
    if (!(image instanceof HTMLImageElement)) return;

    const crop = getCharacterCrop(character);
    applyPreviewCrop(image, crop);
    image.classList.toggle('avatar-display-crop-active', Boolean(crop));
}

function applyAllAvatarPreviews() {
    for (const image of document.querySelectorAll('img')) {
        if (!(image instanceof HTMLImageElement)) continue;
        const source = image.currentSrc || image.src;
        if (!source.includes('thumbnail') && !source.includes('/characters/')) continue;

        const character = characters.find(item => item.avatar && source.includes(encodeURIComponent(item.avatar)));
        if (!character) continue;

        const crop = getCharacterCrop(character);
        applyPreviewCrop(image, crop);
        image.classList.toggle('avatar-display-crop-active', Boolean(crop));
    }
}

async function openCropDialog(source) {
    const dialog = new Popup('Set the display crop of the avatar image', POPUP_TYPE.CROP, '', {
        cropImage: source,
        cropAspect: Number.NaN,
    });
    const result = await dialog.show();
    if (!result || !dialog.cropData) return null;

    const image = new Image();
    image.src = source;
    await image.decode();

    return {
        x: Number(dialog.cropData.x),
        y: Number(dialog.cropData.y),
        width: Number(dialog.cropData.width),
        height: Number(dialog.cropData.height),
        sourceWidth: image.naturalWidth,
        sourceHeight: image.naturalHeight,
    };
}

async function saveCrop(character, crop) {
    if (!character?.avatar) return;
    const characterId = characters.indexOf(character);
    const value = crop ? { crop } : UNSET_VALUE;
    await writeExtensionField(characterId, EXTENSION_KEY, value);
    currentCrop = crop;
    updateEditorPreview(character);
    applyAllAvatarPreviews();
}

async function cropCurrentAvatar() {
    const character = getCurrentCharacter();
    if (!character) return;

    const source = getAvatarSource(character);
    if (!source) return;

    const crop = await openCropDialog(source);
    if (crop) await saveCrop(character, crop);
}

function createButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'menu_button fa-solid fa-scissors';
    button.setAttribute('aria-label', '裁剪显示');
    button.title = '只裁剪头像显示区域，不修改导出图片';
    button.addEventListener('click', cropCurrentAvatar);

    const deleteButton = document.querySelector('#delete_button');
    if (deleteButton?.parentElement) {
        deleteButton.parentElement.insertBefore(button, deleteButton.nextSibling);
    }
}

function updateButtonState() {
    const button = document.getElementById(BUTTON_ID);
    const characterId = characters.findIndex(character => character.avatar === currentAvatar);
    if (!button) return;

    button.dataset.characterId = String(characterId);
    button.disabled = characterId < 0;
}

function onEditorOpened(characterId) {
    const character = characters[characterId];
    currentAvatar = character?.avatar ?? null;
    currentCrop = getCharacterCrop(character);
    updateButtonState();
    updateEditorPreview(character);
    applyAllAvatarPreviews();
}

function interceptNativeUpload() {
    const input = document.querySelector('#add_avatar_button');
    if (!(input instanceof HTMLInputElement) || input.dataset.avatarDisplayCropBound) return;
    input.dataset.avatarDisplayCropBound = 'true';

    input.addEventListener('change', async event => {
        if (!input.files?.[0]) return;

        event.stopImmediatePropagation();
        const file = input.files[0];
        const source = await getBase64Async(file);
        const crop = await openCropDialog(source);
        if (crop) {
            currentCrop = crop;
            currentAvatar = getCurrentCharacter()?.avatar ?? currentAvatar;
            const preview = document.querySelector('#avatar_load_preview');
            if (preview instanceof HTMLImageElement) {
                preview.src = source;
                applyPreviewCrop(preview, crop);
                preview.classList.add('avatar-display-crop-active');
            }

            // Save the original File through SillyTavern's normal character flow.
            await createOrEditCharacter(event);

            const avatar = String($('#avatar_url_pole').val() || currentAvatar || '');
            const character = characters.find(item => item.avatar === avatar);
            if (character) {
                currentAvatar = character.avatar;
                await saveCrop(character, crop);
            }
        }
    }, true);
}

export async function init() {
    extension_settings[EXTENSION_KEY] ??= {};
    createButton();
    interceptNativeUpload();

    eventSource.on(event_types.CHARACTER_EDITOR_OPENED, onEditorOpened);

    const observer = new MutationObserver(() => {
        createButton();
        interceptNativeUpload();
        updateButtonState();
        applyAllAvatarPreviews();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}
