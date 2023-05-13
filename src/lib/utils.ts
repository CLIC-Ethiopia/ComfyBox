import ComfyApp, { type SerializedPrompt } from "./components/ComfyApp";
import ComboWidget from "$lib/widgets/ComboWidget.svelte";
import RangeWidget from "$lib/widgets/RangeWidget.svelte";
import TextWidget from "$lib/widgets/TextWidget.svelte";
import { get } from "svelte/store"
import layoutState from "$lib/stores/layoutState"
import type { SvelteComponentDev } from "svelte/internal";
import type { SerializedLGraph } from "@litegraph-ts/core";
import type { FileNameOrGalleryData, GalleryOutput, GalleryOutputEntry } from "./nodes/ComfyWidgetNodes";
import type { FileData as GradioFileData } from "@gradio/upload";

export function clamp(n: number, min: number, max: number): number {
    return Math.min(Math.max(n, min), max)
}

export function negmod(n: number, m: number): number {
    return ((n % m) + m) % m;
}

export function range(size: number, startAt: number = 0): ReadonlyArray<number> {
    return [...Array(size).keys()].map(i => i + startAt);
}

export function download(filename: string, text: string, type: string = "text/plain") {
    const blob = new Blob([text], { type: type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    setTimeout(function() {
        a.remove();
        window.URL.revokeObjectURL(url);
    }, 0);
}

export function startDrag(evt: MouseEvent) {
    const dragItemId: string = evt.target.dataset["dragItemId"];
    const ls = get(layoutState)

    if (evt.button !== 0) {
        if (ls.currentSelection.length <= 1 && !ls.isMenuOpen)
            ls.currentSelection = [dragItemId]
        return;
    }

    const item = ls.allItems[dragItemId].dragItem

    console.debug("startDrag", item)

    if (evt.ctrlKey) {
        const index = ls.currentSelection.indexOf(item.id)
        if (index === -1)
            ls.currentSelection.push(item.id);
        else
            ls.currentSelection.splice(index, 1);
        ls.currentSelection = ls.currentSelection;
    }
    else {
        ls.currentSelection = [item.id]
    }
    ls.currentSelectionNodes = [];

    layoutState.set(ls)
};

export function stopDrag(evt: MouseEvent) {
};

export function workflowToGraphVis(workflow: SerializedLGraph): string {
    let out = "digraph {\n"

    for (const link of workflow.links) {
        const nodeA = workflow.nodes.find(n => n.id === link[1])
        const nodeB = workflow.nodes.find(n => n.id === link[3])
        out += `"${link[1]}_${nodeA.title}" -> "${link[3]}_${nodeB.title}"\n`;
    }

    out += "}"
    return out
}

export function promptToGraphVis(prompt: SerializedPrompt): string {
    let out = "digraph {\n"

    for (const pair of Object.entries(prompt.output)) {
        const [id, o] = pair;
        const outNode = prompt.workflow.nodes.find(n => n.id == id)
        for (const pair2 of Object.entries(o.inputs)) {
            const [inpName, i] = pair2;

            if (Array.isArray(i) && i.length === 2 && typeof i[0] === "string" && typeof i[1] === "number") {
                // Link
                const inpNode = prompt.workflow.nodes.find(n => n.id == i[0])
                out += `"${inpNode.title}" -> "${outNode.title}"\n`
            }
            else {
                // Value
                out += `"${id}-${inpName}-${i}" -> "${outNode.title}"\n`
            }
        }
    }

    out += "}"
    return out
}

export function getNodeInfo(nodeId: NodeID): string {
    let app = (window as any).app;
    if (!app || !app.lGraph)
        return String(nodeId);

    const title = app.lGraph.getNodeById(nodeId)?.title || String(nodeId);
    return title + " (" + nodeId + ")"
}

export const debounce = (callback: Function, wait = 250) => {
    let timeout: NodeJS.Timeout | null = null;
    return (...args: Array<unknown>) => {
        const next = () => callback(...args);
        if (timeout) clearTimeout(timeout);

        timeout = setTimeout(next, wait);
    };
};

export function convertComfyOutputToGradio(output: GalleryOutput): GradioFileData[] {
    return output.images.map(r => {
        const url = `http://${location.hostname}:8188` // TODO make configurable
        const params = new URLSearchParams(r)
        const fileData: GradioFileData = {
            name: r.filename,
            orig_name: r.filename,
            is_file: false,
            data: url + "/view?" + params
        }
        return fileData
    });
}

export function convertComfyOutputToComfyURL(output: FileNameOrGalleryData): string {
    if (typeof output === "string")
        return output;

    const params = new URLSearchParams(output)
    const url = `http://${location.hostname}:8188` // TODO make configurable
    return url + "/view?" + params
}

export function converGradioFileDataToComfyURL(image: GradioFileData, type: "input" | "output" | "temp" = "input"): string {
    const baseUrl = `http://${location.hostname}:8188` // TODO make configurable
    const params = new URLSearchParams({ filename: image.name, subfolder: "", type })
    return `${baseUrl}/view?${params}`
}

export function convertGradioFileDataToComfyOutput(fileData: GradioFileData, type: "input" | "output" | "temp" = "input"): GalleryOutputEntry {
    if (!fileData.is_file)
        throw "Can't convert blob data to comfy output!"

    return {
        filename: fileData.name,
        subfolder: "",
        type
    }
}

export function convertFilenameToComfyURL(filename: string,
    subfolder: string = "",
    type: "input" | "output" | "temp" = "output"): string {
    const params = new URLSearchParams({
        filename,
        subfolder,
        type
    })
    const url = `http://${location.hostname}:8188` // TODO make configurable
    return url + "/view?" + params
}

export function jsonToJsObject(json: string): string {
    // Try to parse, to see if it's real JSON
    JSON.parse(json);

    const regex = /\"([^"]+)\":/g;
    const hyphenRegex = /-([a-z])/g;

    return json.replace(regex, match => {
        return match
            .replace(hyphenRegex, g => g[1].toUpperCase())
            .replace(regex, "$1:");
    });
}

export interface ComfyUploadImageAPIResponse {
    name: string
}

export async function uploadImageToComfyUI(data: GalleryOutputEntry): Promise<ComfyUploadImageAPIResponse> {
    const url = `http://${location.hostname}:8188` // TODO make configurable
    const params = new URLSearchParams(data)

    return fetch(url + "/view?" + params)
        .then((r) => r.blob())
        .then((blob) => {
            console.debug("Fetchin", url, params)
            const formData = new FormData();
            formData.append("image", blob, data.filename);
            return fetch(
                new Request(url + "/upload/image", {
                    body: formData,
                    method: 'POST'
                })
            )
        })
        .then((r) => r.json())
}
