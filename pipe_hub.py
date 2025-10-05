# Developed by Light-x02
# https://github.com/Light-x02/ComfyUI-Lightx02-Node
import typing as _t

try:
    from .anytype import AnyType
    any = AnyType("*")  # vrai type "any" côté Comfy/validation
except Exception:
    # fallback (marche aussi, mais sans l’égalité spéciale d'AnyType)
    any = "*"

MAX_PAIRS = 30

def _inherit_get(pipe, i: int):
    if pipe is None:
        return None
    if isinstance(pipe, (list, tuple)):
        return pipe[i - 1] if (i - 1) < len(pipe) else None
    if isinstance(pipe, dict):
        return pipe.get(f"slot{i}", None)
    return None

class PipeHub:
    CATEGORY = "💡Lightx02/utilities"

    @classmethod
    def INPUT_TYPES(cls):
        # Entrées dynamiques côté UI (in3..inN) gérées en JS ; ici on n’expose que in1/in2
        return {
            "required": {},
            "optional": {
                "pipe_in": ("pipe", {"forceInput": True}),
                "in1": (any,),
                "in2": (any,),
            },
        }

    # 1er retour = pipe (liste), puis out1..outN => tous en AnyType
    RETURN_TYPES = tuple(["pipe"] + [any for _ in range(MAX_PAIRS)])
    RETURN_NAMES = tuple(["pipe"] + [f"out{i}" for i in range(1, MAX_PAIRS + 1)])
    FUNCTION = "route"

    @classmethod
    def VALIDATE_INPUTS(cls, **_kwargs):
        return True

    def route(self, pipe_in=None, **kwargs):
        upstream = pipe_in
        pipe_out, outs = [], []
        for i in range(1, MAX_PAIRS + 1):
            v_local = kwargs.get(f"in{i}", None)
            v_inh   = _inherit_get(upstream, i)
            v = v_local if v_local is not None else v_inh
            pipe_out.append(v)
            outs.append(v)
        # pipe = liste ordonnée (slot1..slotN)
        return tuple([pipe_out] + outs)

NODE_CLASS_MAPPINGS = {"PipeHub": PipeHub}
NODE_DISPLAY_NAME_MAPPINGS = {"PipeHub": "🔗 Pipe Hub"}

