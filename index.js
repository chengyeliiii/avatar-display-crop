import { characters, createOrEditCharacter, eventSource, event_types, getRequestHeaders } from '../../../../script.js';
import { extension_settings, UNSET_VALUE, writeExtensionField } from '../../../../scripts/extensions.js';
import { Popup, POPUP_TYPE } from '../../../../scripts/popup.js';
import { getBase64Async } from '../../../../scripts/utils.js';

const EXTENSION_KEY = 'avatar_display_crop';
const BUTTON_ID = 'avatar_display_crop_button';
const INPUT_ID = 'add_avatar_button';
const EDITOR_PREVIEW_SELECTOR = '#avatar_load_preview';

const state = {
    editorAvatar: null,
    uploading: false,
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
        ? `/characters/${encodeURIComponent(character.avatar)}${imageVersions.has(character.avatar) ? `?adc=${imageVersions.get(character.avatar)}` : ''}`
        : '';
}

function getImageCharacter(image) {
    if (image.matches(EDITOR_PREVIEW_SELECTOR)) return getEditorCharacter();
    const previous = renderedImages.get(image);
    const source = previous && image.src === previous.preview ? previous.source : image.src;
    const url = new URL(source, location.href);
    const avatar = url.pathname === '/thumbnail' && url.searchParams.get('type') === 'avatar'
        ? url.searchParams.get('file')
        : url.pathname.startsWith('/characters/') ? decodeURIComponent(url.pathname.slice(12)) : null;
    return getCharacterByAvatar(avatar);
}

const renderedImages = new WeakMap();
const previews = new Map();
const imageVersions = new Map();

function clearCropStyles(image) {
    const previous = renderedImages.get(image);
    if (previous && image.src === previous.preview) image.src = previous.source;
    renderedImages.delete(image);
    image.style.removeProperty('object-fit');
    image.style.removeProperty('object-position');
    image.classList.remove('avatar-display-crop-active');
}

async function applyCrop(image, crop, source = image.src) {
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

    if (sourceWidth <= 0 || sourceHeight <= 0 || cropWidth <= 0 || cropHeight <= 0) return;
    const key = JSON.stringify([source, crop]);
    const previous = renderedImages.get(image);
    if (previous?.key === key && image.src === previous.preview) return;
    if (previous?.key === key && previous.preview === null) return;
    const startingSource = image.src;
    const record = { key, source: previous && image.src === previous.preview ? previous.source : image.src, preview: null };
    renderedImages.set(image, record);
    if (!previews.has(key)) {
        const promise = (async () => {
            const original = new Image();
            original.src = source;
            await original.decode();
            // Old saved coordinates may be relative to a thumbnail. Normalize them.
            const x = Math.max(0, cropX / sourceWidth) * original.naturalWidth;
            const y = Math.max(0, cropY / sourceHeight) * original.naturalHeight;
            const width = Math.min(cropWidth / sourceWidth * original.naturalWidth, original.naturalWidth - x);
            const height = Math.min(cropHeight / sourceHeight * original.naturalHeight, original.naturalHeight - y);
            if (width <= 0 || height <= 0) throw new Error('Invalid crop bounds');
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, 1024 / Math.max(width, height));
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            canvas.getContext('2d').drawImage(original, x, y, width, height, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/png');
        })();
        if (previews.size >= 64) previews.delete(previews.keys().next().value);
        previews.set(key, promise);
    }
    try {
        const preview = await previews.get(key);
        if (renderedImages.get(image) !== record || image.src !== startingSource) return;
        record.preview = preview;
        image.src = preview;
        image.style.objectFit = 'contain';
        image.style.objectPosition = 'center';
        image.classList.add('avatar-display-crop-active');
    } catch (error) {
        previews.delete(key);
        if (renderedImages.get(image) === record) renderedImages.delete(image);
        console.error('[Avatar Display Crop] Preview failed', error);
    }
}

function renderAvatars() {
    state.renderQueued = false;
    if (state.uploading) return;
    for (const image of document.querySelectorAll('.avatar img, #avatar_load_preview')) {
        if (!(image instanceof HTMLImageElement)) continue;
        if (image.closest('.cropper-container, .popup-crop-wrap, .zoomed_avatar')) continue;
        const character = getImageCharacter(image);
        if (character) void applyCrop(image, getCrop(character), getAvatarUrl(character));
        else if (renderedImages.has(image)) clearCropStyles(image);
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
        cropAspect: 1,
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
    previews.clear();
    queueRender();
}

async function cropExistingAvatar() {
    if (state.uploading) return;
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

    const button = document.createElement('button');
    button.type = 'button';
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
    if (state.uploading) {
        input.value = '';
        return;
    }
    const file = input.files[0];
    const isCreate = document.querySelector('#form_create')?.getAttribute('actiontype') === 'createcharacter';
    const targetAvatar = isCreate ? null : String($('#avatar_url_pole').val() || state.editorAvatar || '');
    state.uploading = true;
    // Invalidate pending asynchronous renders before opening any dialogs.
    for (const image of document.querySelectorAll('.avatar img, #avatar_load_preview')) {
        clearCropStyles(image);
    }
    try {
        const choice = await new Popup('上传新头像后是否裁剪显示？原图将完整保留。', POPUP_TYPE.CONFIRM, '', {
            okButton: '裁剪',
            cancelButton: '取消上传',
            customButtons: [{ text: '不裁剪', result: 2 }],
        }).show();
        if (choice !== 1 && choice !== 2) return;
        const source = await getBase64Async(file);
        const crop = choice === 1 ? await readCrop(source) : null;
        if (choice === 1 && !crop) return;

        let character;
        if (targetAvatar) {
            // Upload only the original image, never crop parameters or a preview.
            const body = new FormData();
            body.set('avatar', file);
            body.set('avatar_url', targetAvatar);
            const response = await fetch('/api/characters/edit-avatar', {
                method: 'POST', headers: getRequestHeaders({ omitContentType: true }), body,
            });
            if (!response.ok) throw new Error(`Avatar upload failed (${response.status})`);
            character = getCharacterByAvatar(targetAvatar);
        } else {
            await createOrEditCharacter(event);
            character = getCharacterByAvatar(String($('#avatar_url_pole').val() || ''));
            if (!character) throw new Error('Create the character before uploading its avatar.');
        }
        if (!character) throw new Error('Character no longer exists');
        imageVersions.set(character.avatar, Date.now());
        previews.clear();
        // Refresh every visible reference, including the editor's previous data URL.
        for (const image of document.querySelectorAll('.avatar img, #avatar_load_preview')) {
            if (getImageCharacter(image)?.avatar !== character.avatar) continue;
            clearCropStyles(image);
            image.src = getAvatarUrl(character);
        }
        await saveCrop(character, crop);
    } catch (error) {
        console.error('[Avatar Display Crop] Upload failed', error);
        toastr.error(String(error.message), '头像上传失败');
    } finally {
        input.value = '';
        state.uploading = false;
        queueRender();
    }
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
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
}

export async function init() {
    extension_settings[EXTENSION_KEY] ??= {};
    ensureButton();
    bindUploadInput();
    eventSource.on(event_types.CHARACTER_EDITOR_OPENED, onEditorOpened);
    observeUi();
    queueRender();
}
