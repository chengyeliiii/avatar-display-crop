import { characters, createOrEditCharacter, eventSource, event_types } from '../../../../script.js';
import { extension_settings, writeExtensionField, UNSET_VALUE } from '../../../../scripts/extensions.js';
import { Popup, POPUP_TYPE } from '../../../../scripts/popup.js';

const EXTENSION_KEY = 'avatar_display_crop';
const BUTTON_ID = 'avatar_display_crop_button';

let currentCrop = null;
let currentAvatar = null;

function getCharacterCrop(character) {
    return character?.data?.extensions?.[EXTENSION_KEY]?.crop ?? null;
}

function getCurrentCharacter() {
    const characterId = $('#avatar_display_crop_button').data('character-id');
    return Number.isInteger(characterId) ? characters[characterId] : null;
}

function getAvatarSource(character) {
    if (!character?.avatar || character.avatar === 'none') return '';
    return `/thumbnail?type=avatar&file=${encodeURIComponent(character.avatar)}`;
}

function applyPreviewCrop(image, crop) {
    if (!image || !crop) {
        image?.style.removeProperty('object-position');
        image?.style.removeProperty('transform');
        return;
    }

    const sourceWidth = Number(crop.sourceWidth) || Number(crop.width);
    const sourceHeight = Number(crop.sourceHeight) || Number(crop.height);
    const centerX = Number(crop.x) + Number(crop.width) / 2;
    const centerY = Number(crop.y) + Number(crop.height) / 2;

    if (!sourceWidth || !sourceHeight) return;

    image.style.objectPosition = `${(centerX / sourceWidth) * 100}% ${(centerY / sourceHeight) * 100}%`;
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
        if (!source.includes('type=avatar') && !source.includes('/characters/')) continue;

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
    button.className = 'menu_button';
    button.textContent = '裁剪显示';
    button.title = '只裁剪头像显示区域，不修改导出图片';
    button.addEventListener('click', cropCurrentAvatar);

    const avatarContainer = document.querySelector('#avatar_div');
    avatarContainer?.append(button);
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
        const source = URL.createObjectURL(file);
        try {
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
        } finally {
            URL.revokeObjectURL(source);
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
