# Developed by Light-x02
# https://github.com/Light-x02/ComfyUI-Lightx02-Node

import os
import json
import re
from typing import Tuple, List, Dict, Any
from PIL import Image

# ----- helpers -----

LORA_TAG_RE = re.compile(r'\s*<lora:[^>]+>')

def strip_lora_tags(text: str) -> str:
    if not isinstance(text, str):
        return ""
    return LORA_TAG_RE.sub('', text).strip()

def extract_lora_and_steps(parameters: str) -> str:
    if not isinstance(parameters, str):
        return ""
    loras = " ".join(re.findall(r'<lora:[^>]+>', parameters))
    m = re.search(r'(Steps:\s.*)', parameters, re.DOTALL)
    tail = m.group(1).strip() if m else ""
    if loras and tail:
        return f"{loras}\n{tail}"
    return (loras or tail).strip()

def extract_prompts_from_parameters(parameters: str) -> Tuple[str, str]:
    if not isinstance(parameters, str):
        return "", ""
    neg_match = re.search(r'Negative prompt:\s*(.*)', parameters, re.DOTALL)
    if neg_match:
        positive = parameters.split('Negative prompt:')[0].strip()
        negative = neg_match.group(1).split('Steps:')[0].strip()
        return strip_lora_tags(positive), strip_lora_tags(negative)
    positive = parameters.split('Steps:')[0].strip()
    return strip_lora_tags(positive), ""

def _extract_from_workflow_json_str(workflow_str: str) -> Tuple[str, str]:
    if not isinstance(workflow_str, str) or not workflow_str:
        return "", ""
    try:
        wf = json.loads(workflow_str)
    except Exception:
        return "", ""

    if not isinstance(wf, dict) or 'nodes' not in wf or not isinstance(wf.get('nodes'), list):
        if isinstance(wf, dict):
            p = wf.get('prompt') or wf.get('positive') or ""
            n = wf.get('negative') or ""
            return strip_lora_tags(str(p)), strip_lora_tags(str(n))
        return "", ""

    nodes_by_id: Dict[str, Any] = {str(n.get('id')): n for n in wf['nodes']}
    all_links = wf.get('links', [])

    def is_sampler(node: Dict[str, Any]) -> bool:
        return isinstance(node, dict) and 'Sampler' in str(node.get('type', ''))

    def check_downstream_for_sampler(start_node: Dict[str, Any], visited=None) -> bool:
        if visited is None:
            visited = set()
        sid = str(start_node.get('id'))
        if sid in visited:
            return False
        visited.add(sid)
        if is_sampler(start_node):
            return True
        for outp in start_node.get('outputs', []):
            for link_id in outp.get('links', []):
                link_info = next((l for l in all_links if str(l[0]) == str(link_id)), None)
                if link_info:
                    target_node = nodes_by_id.get(str(link_info[3]))
                    if target_node and check_downstream_for_sampler(target_node, visited):
                        return True
        return False

    def resolve_text_fallback(node: Dict[str, Any]) -> str:
        inputs = node.get('inputs', [])
        if not any(i.get('type') == 'STRING' and 'link' in i for i in inputs):
            widgets = node.get('widgets_values', [])
            val = next((w for w in widgets if isinstance(w, str)), "")
            return strip_lora_tags(val)
        collected = ""
        for i in inputs:
            if i.get('type') == 'STRING' and 'link' in i:
                link_info = next((l for l in all_links if str(l[0]) == str(i['link'])), None)
                if link_info:
                    origin_id = str(link_info[1])
                    origin_node = nodes_by_id.get(origin_id)
                    if origin_node:
                        collected += resolve_text_fallback(origin_node)
        return strip_lora_tags(collected)

    pos_prompts: List[str] = []
    neg_prompts: List[str] = []

    for node in wf['nodes']:
        if 'CLIPTextEncode' in str(node.get('type', '')):
            if not check_downstream_for_sampler(node):
                continue
            text_input = next((i for i in node.get('inputs', []) if i.get('name') == 'text'), None)
            if text_input and 'link' in text_input:
                link_info = next((l for l in all_links if str(l[0]) == str(text_input['link'])), None)
                if link_info:
                    origin_node = nodes_by_id.get(str(link_info[1]))
                    prompt_text = resolve_text_fallback(origin_node) if origin_node else ""
                else:
                    prompt_text = ""
            else:
                prompt_text = (node.get('widgets_values') or [""])[0] if isinstance(node.get('widgets_values'), list) else ""
            prompt_text = strip_lora_tags(prompt_text)
            if 'negative' in str(node.get('title', '')).lower():
                neg_prompts.append(prompt_text)
            else:
                pos_prompts.append(prompt_text)

    return " ".join(pos_prompts).strip(), " ".join(neg_prompts).strip()

def extract_prompts_from_metadata(meta: Dict[str, Any]) -> Tuple[str, str]:
    if not isinstance(meta, dict):
        return "", ""
    params = meta.get('parameters')
    if isinstance(params, str) and params.strip():
        return extract_prompts_from_parameters(params)
    wf = meta.get('workflow') or meta.get('prompt')
    if isinstance(wf, str) and wf.strip():
        return _extract_from_workflow_json_str(wf)
    raw_pos = meta.get('prompt', '')
    return strip_lora_tags(str(raw_pos)), ""

def collect_from_paths_json(paths_json: str) -> Tuple[str, str, str]:
    positive_acc: List[str] = []
    negative_acc: List[str] = []
    info_blocks: List[str] = []

    try:
        items = json.loads(paths_json)
        if not isinstance(items, list):
            items = []
    except Exception:
        items = []

    for it in items:
        if not isinstance(it, dict):
            continue
        if it.get('type') != 'image':
            continue

        meta = it.get('metadata') or {}
        if (not meta) and it.get('path') and os.path.exists(it['path']):
            try:
                with Image.open(it['path']) as im:
                    meta = {}
                    if 'parameters' in im.info: meta['parameters'] = im.info['parameters']
                    if 'prompt' in im.info: meta['prompt'] = im.info['prompt']
                    if 'workflow' in im.info: meta['workflow'] = im.info['workflow']
            except Exception:
                meta = {}

        pos, neg = extract_prompts_from_metadata(meta)
        if pos: positive_acc.append(pos)
        if neg: negative_acc.append(neg)

        params = meta.get('parameters')
        if isinstance(params, str):
            trimmed = extract_lora_and_steps(params)
            if trimmed:
                info_blocks.append(trimmed)

    positive_prompt = " ".join(positive_acc).strip()
    negative_prompt = " ".join(negative_acc).strip()

    if not info_blocks:
        info_out = ""
    elif len(info_blocks) == 1:
        info_out = info_blocks[0]
    else:
        info_out = json.dumps(info_blocks, ensure_ascii=False, indent=4)

    return positive_prompt, negative_prompt, info_out

# ----- node -----

class LMMExtractPromptsNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "paths": ("LMM_ALL_PATHS", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING",)
    RETURN_NAMES = ("positive_prompt", "negative_prompt", "info",)
    FUNCTION = "extract"
    CATEGORY = "💡Lightx02/utilities"

    def extract(self, paths):
        pos, neg, inf = collect_from_paths_json(paths)
        return (pos, neg, inf)

# ----- register -----

NODE_CLASS_MAPPINGS = {
    "LMMExtractPromptsNode": LMMExtractPromptsNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LMMExtractPromptsNode": "📝 LMM Extract Prompts",
}

