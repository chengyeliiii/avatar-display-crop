import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export async function init', 'async function init');
const draws = [];
let serial = 0;
const context = vm.createContext({
    console, URL, location: { href: 'http://localhost/' }, characters: [],
    Image: class {
        naturalWidth = 1000;
        naturalHeight = 800;
        async decode() {}
    },
    document: { createElement() {
        return { getContext: () => ({ drawImage: (...args) => draws.push(args.slice(1)) }),
            toDataURL: () => `data:image/png;base64,${++serial}` };
    } },
});
vm.runInContext(source, context);
const image = { src: 'http://localhost/thumbnail?type=avatar&file=A.png',
    style: { removeProperty() {} }, classList: { add() {}, remove() {} } };
context.image = image;
await vm.runInContext(`applyCrop(image, { x: 700, y: 100, width: 200, height: 300, sourceWidth: 1000, sourceHeight: 800 }, '/characters/A.png')`, context);
assert.deepEqual(draws[0], [700, 100, 200, 300, 0, 0, 200, 300]);
assert.equal(image.src, 'data:image/png;base64,1');
await vm.runInContext(`applyCrop(image, { x: 50, y: 50, width: 100, height: 100, sourceWidth: 1000, sourceHeight: 800 }, '/characters/A.png')`, context);
assert.equal(image.src, 'data:image/png;base64,2', 'Repeated crop replaces the preview');
assert.equal(image.style.objectFit, 'contain');
await vm.runInContext('applyCrop(image, null)', context);
assert.equal(image.src, 'http://localhost/thumbnail?type=avatar&file=A.png');
await vm.runInContext(`applyCrop(image, { x: 350, y: 50, width: 100, height: 150, sourceWidth: 500, sourceHeight: 400 }, '/characters/A.png')`, context);
assert.deepEqual(draws[2], [700, 100, 200, 300, 0, 0, 200, 300]);
console.log('Passed: right-side crop, repeated crop, restore, thumbnail coordinate scaling');
