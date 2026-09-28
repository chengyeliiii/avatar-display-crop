import { characters, createOrEditCharacter, eventSource, event_types, getThumbnailUrl } from '../../../../script.js';
import { extension_settings, UNSET_VALUE, writeExtensionField } from '../../../../scripts/extensions.js';
import { Popup, POPUP_TYPE } from '../../../../scripts/popup.js';
import { getBase64Async } from '../../../../scripts/utils.js';

const EXTENSION_KEY = 'avatar_display_crop';
const BUTTON_ID = 'avatar_display_crop_button';
const INPUT_ID = 'add_avatar_button';
const EDITOR_PREVIEW_SELECTOR = '#avatar_load_preview';

const state = {
    editorAvatar: null,
    pendingCrop: null,
    renderQueued: false,
};

function getCrop(character) {
    const crop = character?.data?.extensions?.[EXTENSION_KEY]?.crop;
    return crop && typeof crop === 'object' ? crop : null;
}

function getCharacterByAvatar(avatar) {
    return characters.find(character => character?.avatar === avatar) ?? null;
}

function getEditorCharacter() {
    return getCharacterByAvatar(state.editorAvatar);
}

function getAvatarUrl(character) {
    return character?.avatar && character.avatar !== 'none'
        ? getThumbnailUrl('avatar', character.avatar)
        : '';
}

function getImageCharacter(image) {
    const source = image.currentSrc || image.src;
    return characters.find(character => {
        if (!character?.avatar || character.avatar === 'none') return false;
        const avatar = encodeURIComponent(character.avatar);
        return source.includes(avatar) || source.includes(character.avatar);
    }) ?? null;
}

function clearCropStyles(image) {
    image.style.removeProperty('object-fit');
    image.style.removeProperty('object-position');
    image.classList.remove('avatar-display-crop-active');
}

/**
 * Apply a crop using the actual source viewport exposed by object-fit: cover.
 * object-position percentages are relative to the overflow, not the source image.
 */
function applyCrop(image, crop) {
    if (!crop) {
        clearCropStyles(image);
        return;
    }

    const sourceWidth = Number(crop.sourceWidth);
    const sourceHeight = Number(crop.sourceHeight);
    const cropX = Number(crop.x);
    const cropY = Number(crop.y);
    const cropWidth = Number(crop.width);
    const cropHeight = Number(crop.height);

    if (![sourceWidth, sourceHeight, cropX, cropY, cropWidth, cropHeight].every(Number.isFinite)) {
        clearCropStyles(image);
        return;
    }

    const boxWidth = image.clientWidth;
    const boxHeight = image.clientHeight;
    if (!boxWidth || !boxHeight || !sourceWidth || !sourceHeight || !cropWidth || !cropHeight) return;

    const boxRatio = boxWidth / boxHeight;
    const sourceRatio = sourceWidth / sourceHeight;
    const viewportWidth = sourceRatio > boxRatio ? sourceHeight * boxRatio : sourceWidth;
    const viewportHeight = sourceRatio > boxRatio ? sourceHeight : sourceWidth / boxRatio;
    const maxX = Math.max(0, sourceWidth - viewportWidth);
    const maxY = Math.max(0, sourceHeight - viewportHeight);
    const centerX = cropX + cropWidth / 2;
    const centerY = cropY + cropHeight / 2;
    const positionX = maxX ? ((centerX - viewportWidth / 2) / maxX) * 100 : 50;
    const positionY = maxY ? ((centerY - viewportHeight / 2) / maxY) * 100 : 50;

    image.style.objectFit = 'cover';
    image.style.objectPosition = `${Math.max(0, Math.min(100, positionX))}% ${Math.max(0, Math.min(100, positionY))}%`;
    image.classList.add('avatar-display-crop-active');
}

function renderAvatars() {
    state.renderQueued = false;
    for (const image of document.querySelectorAll('img')) {
        if (!(image instanceof HTMLImageElement)) continue;
        const character = getImageCharacter(image);
        if (character) applyCrop(image, getCrop(character));
    }
}

function queueRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(renderAvatars);
}

async function readCrop(source) {
    const dialog = new Popup('Set the display crop of the avatar image', POPUP_TYPE.CROP, '', {
        cropImage: source,
        cropAspect: Number.NaN,
    });
    const result = await dialog.show();
    if (!result || !dialog.cropData) return null;

    const image = new Image();
    image.src = source;
    await image.decode();

    const data = dialog.cropData;
    return {
        x: Number(data.x),
        y: Number(data.y),
        width: Number(data.width),
        height: Number(data.height),
        sourceWidth: image.naturalWidth,
        sourceHeight: image.naturalHeight,
    };
}

async function saveCrop(character, crop) {
    if (!character?.avatar) return;
    const characterId = characters.indexOf(character);
    await writeExtensionField(
        characterId,
        EXTENSION_KEY,
        crop ? { crop } : UNSET_VALUE,
    );
    queueRender();
}

async function cropExistingAvatar() {
    const character = getEditorCharacter();
    const source = getAvatarUrl(character);
    if (!character || !source) return;

    const crop = await readCrop(source);
    if (crop) await saveCrop(character, crop);
}

function updateButton() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    const character = getEditorCharacter();
    button.disabled = !character || !getAvatarUrl(character);
    button.dataset.characterId = String(character ? characters.indexOf(character) : -1);
}

function ensureButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const deleteButton = document.querySelector('#delete_button');
    if (!deleteButton?.parentElement) return;

    const button = document.createElement('div');
    button.id = BUTTON_ID;
    button.className = 'menu_button fa-solid fa-scissors';
    button.title = '只裁剪头像显示区域，不修改导出图片';
    button.setAttribute('aria-label', '裁剪显示');
    button.addEventListener('click', cropExistingAvatar);
    deleteButton.parentElement.insertBefore(button, deleteButton.nextSibling);
}

async function handleAvatarUpload(event) {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;

    event.stopImmediatePropagation();
    const source = await getBase64Async(input.files[0]);
    const crop = await readCrop(source);
    if (!crop) {
        input.value = '';
        return;
    }

    state.pendingCrop = crop;
    const preview = document.querySelector(EDITOR_PREVIEW_SELECTOR);
    if (preview instanceof HTMLImageElement) {
        preview.src = source;
        applyCrop(preview, crop);
    }

    // The original File remains in the input and is sent unchanged.
    await createOrEditCharacter(event);

    const avatar = String($('#avatar_url_pole').val() || state.editorAvatar || '');
    const character = getCharacterByAvatar(avatar);
    if (character) {
        state.editorAvatar = character.avatar;
        await saveCrop(character, state.pendingCrop);
    }
    state.pendingCrop = null;
}

function bindUploadInput() {
    const input = document.getElementById(INPUT_ID);
    if (!(input instanceof HTMLInputElement) || input.dataset.avatarDisplayCropBound === 'true') return;
    input.dataset.avatarDisplayCropBound = 'true';
    input.addEventListener('change', handleAvatarUpload, true);
}

function onEditorOpened(characterId) {
    const character = characters[characterId];
    state.editorAvatar = character?.avatar ?? null;
    updateButton();
    queueRender();
}

function observeUi() {
    const observer = new MutationObserver(() => {
        ensureButton();
        bindUploadInput();
        updateButton();
        queueRender();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

export async function init() {
    extension_settings[EXTENSION_KEY] ??= {};
    ensureButton();
    bindUploadInput();
    eventSource.on(event_types.CHARACTER_EDITOR_OPENED, onEditorOpened);
    observeUi();
    queueRender();
}
