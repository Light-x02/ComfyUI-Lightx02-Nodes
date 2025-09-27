# Properties

> Properties of a custom node

### Simple Example

Here's the code for the Invert Image Node, which gives an overview of the key concepts in custom node development.

```python
class InvertImageNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": { "image_in" : ("IMAGE", {}) },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image_out",)
    CATEGORY = "examples"
    FUNCTION = "invert"

    def invert(self, image_in):
        image_out = 1 - image_in
        return (image_out,)
```

### Main properties

Every custom node is a Python class, with the following key properties:

#### INPUT\_TYPES

`INPUT_TYPES`, as the name suggests, defines the inputs for the node. The method returns a `dict`
which *must* contain the key `required`, and *may* also include the keys `optional` and/or `hidden`. The only difference
between `required` and `optional` inputs is that `optional` inputs can be left unconnected.
For more information on `hidden` inputs, see [Hidden Inputs](./more_on_inputs#hidden-inputs).

Each key has, as its value, another `dict`, in which key-value pairs specify the names and types of the inputs.
The types are defined by a `tuple`, the first element of which defines the data type,
and the second element of which is a `dict` of additional parameters.

Here we have just one required input, named `image_in`, of type `IMAGE`, with no additional parameters.

Note that unlike the next few attributes, this `INPUT_TYPES` is a `@classmethod`. This is so
that the options in dropdown widgets (like the name of the checkpoint to be loaded) can be
computed by Comfy at run time. We'll go into this more later. {/* TODO link when written */}

#### RETURN\_TYPES

A `tuple` of `str` defining the data types returned by the node.
If the node has no outputs this must still be provided `RETURN_TYPES = ()`
<Warning>If you have exactly one output, remember the trailing comma: `RETURN_TYPES = ("IMAGE",)`.
This is required for Python to make it a `tuple`</Warning>

#### RETURN\_NAMES

The names to be used to label the outputs. This is optional; if omitted, the names are simply the `RETURN_TYPES` in lowercase.

#### CATEGORY

Where the node will be found in the ComfyUI **Add Node** menu. Submenus can be specified as a path, eg. `examples/trivial`.

#### FUNCTION

The name of the Python function in the class that should be called when the node is executed.

The function is called with named arguments. All `required` (and `hidden`) inputs will be included;
`optional` inputs will be included only if they are connected, so you should provide default values for them in the function
definition (or capture them with `**kwargs`).

The function returns a tuple corresponding to the `RETURN_TYPES`. This is required even if nothing is returned (`return ()`).
Again, if you only have one output, remember that trailing comma `return (image_out,)`!

### Execution Control Extras

A great feature of Comfy is that it caches outputs,
and only executes nodes that might produce a different result than the previous run.
This can greatly speed up lots of workflows.

In essence this works by identifying which nodes produce an output (these, notably the Image Preview and Save Image nodes, are always executed), and then working
backwards to identify which nodes provide data that might have changed since the last run.

Two optional features of a custom node assist in this process.

#### OUTPUT\_NODE

By default, a node is not considered an output. Set `OUTPUT_NODE = True` to specify that it is.

#### IS\_CHANGED

By default, Comfy considers that a node has changed if any of its inputs or widgets have changed.
This is normally correct, but you may need to override this if, for instance, the node uses a random
number (and does not specify a seed - it's best practice to have a seed input in this case so that
the user can control reproducibility and avoid unnecessary execution), or loads an input that may have
changed externally, or sometimes ignores inputs (so doesn't need to execute just because those inputs changed).

<Warning>Despite the name, IS\_CHANGED should not return a `bool`</Warning>

`IS_CHANGED` is passed the same arguments as the main function defined by `FUNCTION`, and can return any
Python object. This object is compared with the one returned in the previous run (if any) and the node
will be considered to have changed if `is_changed != is_changed_old` (this code is in `execution.py` if you need to dig).

Since `True == True`, a node that returns `True` to say it has changed will be considered not to have! I'm sure this would
be changed in the Comfy code if it wasn't for the fact that it might break existing nodes to do so.

To specify that your node should always be considered to have changed (which you should avoid if possible, since it
stops Comfy optimising what gets run), `return float("NaN")`. This returns a `NaN` value, which is not equal
to anything, even another `NaN`.

A good example of actually checking for changes is the code from the built-in LoadImage node, which loads the image and returns a hash

```python
    @classmethod
    def IS_CHANGED(s, image):
        image_path = folder_paths.get_annotated_filepath(image)
        m = hashlib.sha256()
        with open(image_path, 'rb') as f:
            m.update(f.read())
        return m.digest().hex()
```

### Other attributes

There are three other attributes that can be used to modify the default Comfy treatment of a node.

#### INPUT\_IS\_LIST, OUTPUT\_IS\_LIST

These are used to control sequential processing of data, and are described [later](./lists).

### VALIDATE\_INPUTS

If a class method `VALIDATE_INPUTS` is defined, it will be called before the workflow begins execution.
`VALIDATE_INPUTS` should return `True` if the inputs are valid, or a message (as a `str`) describing the error (which will prevent execution).

#### Validating Constants

<Warning>Note that `VALIDATE_INPUTS` will only receive inputs that are defined as constants within the workflow. Any inputs that are received from other nodes will *not* be available in `VALIDATE_INPUTS`.</Warning>

`VALIDATE_INPUTS` is called with only the inputs that its signature requests (those returned by `inspect.getfullargspec(obj_class.VALIDATE_INPUTS).args`). Any inputs which are received in this way will *not* run through the default validation rules. For example, in the following snippet, the front-end will use the specified `min` and `max` values of the `foo` input, but the back-end will not enforce it.

```python
class CustomNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": { "foo" : ("INT", {"min": 0, "max": 10}) },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, foo):
        # YOLO, anything goes!
        return True
```

Additionally, if the function takes a `**kwargs` input, it will receive *all* available inputs and all of them will skip validation as if specified explicitly.

#### Validating Types

If the `VALIDATE_INPUTS` method receives an argument named `input_types`, it will be passed a dictionary in which the key is the name of each input which is connected to an output from another node and the value is the type of that output.

When this argument is present, all default validation of input types is skipped. Here's an example making use of the fact that the front-end allows for the specification of multiple types:

```python
class AddNumbers:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "input1" : ("INT,FLOAT", {"min": 0, "max": 1000})
                "input2" : ("INT,FLOAT", {"min": 0, "max": 1000})
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, input_types):
        # The min and max of input1 and input2 are still validated because
        # we didn't take `input1` or `input2` as arguments
        if input_types["input1"] not in ("INT", "FLOAT"):
            return "input1 must be an INT or FLOAT type"
        if input_types["input2"] not in ("INT", "FLOAT"):
            return "input2 must be an INT or FLOAT type"
        return True
```

# Lifecycle

## How Comfy loads custom nodes

When Comfy starts, it scans the directory `custom_nodes` for Python modules, and attempts to load them.
If the module exports `NODE_CLASS_MAPPINGS`, it will be treated as a custom node.
<Tip>A python module is a directory containing an `__init__.py` file.
The module exports whatever is listed in the `__all__` attribute defined in `__init__.py`.</Tip>

### **init**.py

`__init__.py` is executed when Comfy attempts to import the module. For a module to be recognized as containing
custom node definitions, it needs to export `NODE_CLASS_MAPPINGS`. If it does (and if nothing goes wrong in the import),
the nodes defined in the module will be available in Comfy. If there is an error in your code,
Comfy will continue, but will report the module as having failed to load. So check the Python console!

A very simple `__init__.py` file would look like this:

```python
from .python_file import MyCustomNode
NODE_CLASS_MAPPINGS = { "My Custom Node" : MyCustomNode }
__all__ = ["NODE_CLASS_MAPPINGS"]
```

#### NODE\_CLASS\_MAPPINGS

`NODE_CLASS_MAPPINGS` must be a `dict` mapping custom node names (unique across the Comfy install)
to the corresponding node class.

#### NODE\_DISPLAY\_NAME\_MAPPINGS

`__init__.py` may also export `NODE_DISPLAY_NAME_MAPPINGS`, which maps the same unique name to a display name for the node.
If `NODE_DISPLAY_NAME_MAPPINGS` is not provided, Comfy will use the unique name as the display name.

#### WEB\_DIRECTORY

If you are deploying client side code, you will also need to export the path, relative to the module, in which the
JavaScript files are to be found. It is conventional to place these in a subdirectory of your custom node named `js`.
<Tip>*Only* `.js` files will be served; you can't deploy `.css` or other types in this way</Tip>

<Warning>In previous versions of Comfy, `__init__.py` was required to copy the JavaScript files into the main Comfy web
subdirectory. You will still see code that does this. Don't.</Warning>

# Datatypes

These are the most important built in datatypes. You can also [define your own](./more_on_inputs#custom-datatypes).

Datatypes are used on the client side to prevent a workflow from passing the wrong form of data into a node - a bit like strong typing.
The JavaScript client side code will generally not allow a node output to be connected to an input of a different datatype,
although a few exceptions are noted below.

## Comfy datatypes

### COMBO

* No additional parameters in `INPUT_TYPES`

* Python datatype: defined as `list[str]`, output value is `str`

Represents a dropdown menu widget.
Unlike other datatypes, `COMBO` it is not specified in `INPUT_TYPES` by a `str`, but by a `list[str]`
corresponding to the options in the dropdown list, with the first option selected by default.

`COMBO` inputs are often dynamically generated at run time. For instance, in the built-in `CheckpointLoaderSimple` node, you find

```
"ckpt_name": (folder_paths.get_filename_list("checkpoints"), )
```

or they might just be a fixed list of options,

```
"play_sound": (["no","yes"], {}),
```

### Primitive and reroute

Primitive and reroute nodes only exist on the client side. They do not have an intrinsic datatype, but when connected they take on
the datatype of the input or output to which they have been connected (which is why they can't connect to a `*` input...)

## Python datatypes

### INT

* Additional parameters in `INPUT_TYPES`:

  * `default` is required

  * `min` and `max` are optional

* Python datatype `int`

### FLOAT

* Additional parameters in `INPUT_TYPES`:

  * `default` is required

  * `min`, `max`, `step` are optional

* Python datatype `float`

### STRING

* Additional parameters in `INPUT_TYPES`:

  * `default` is required

* Python datatype `str`

### BOOLEAN

* Additional parameters in `INPUT_TYPES`:

  * `default` is required

* Python datatype `bool`

## Tensor datatypes

### IMAGE

* No additional parameters in `INPUT_TYPES`

* Python datatype `torch.Tensor` with *shape* \[B,H,W,C]

A batch of `B` images, height `H`, width `W`, with `C` channels (generally `C=3` for `RGB`).

### LATENT

* No additional parameters in `INPUT_TYPES`

* Python datatype `dict`, containing a `torch.Tensor` with *shape* \[B,C,H,W]

The `dict` passed contains the key `samples`, which is a `torch.Tensor` with *shape* \[B,C,H,W] representing
a batch of `B` latents, with `C` channels (generally `C=4` for existing stable diffusion models), height `H`, width `W`.

The height and width are 1/8 of the corresponding image size (which is the value you set in the Empty Latent Image node).

Other entries in the dictionary contain things like latent masks.

{/* TODO need to dig into this */}

{/* TODO new SD models might have different C values? */}

### MASK

* No additional parameters in `INPUT_TYPES`

* Python datatype `torch.Tensor` with *shape* \[H,W] or \[B,C,H,W]

### AUDIO

* No additional parameters in `INPUT_TYPES`

* Python datatype `dict`, containing a `torch.Tensor` with *shape* \[B, C, T] and a sample rate.

The `dict` passed contains the key `waveform`, which is a `torch.Tensor` with *shape* \[B, C, T] representing a batch of `B` audio samples, with `C` channels (`C=2` for stereo and `C=1` for mono), and `T` time steps (i.e., the number of audio samples).

The `dict` contains another key `sample_rate`, which indicates the sampling rate of the audio.

## Custom Sampling datatypes

### Noise

The `NOISE` datatype represents a *source* of noise (not the actual noise itself). It can be represented by any Python object
that provides a method to generate noise, with the signature `generate_noise(self, input_latent:Tensor) -> Tensor`, and a
property, `seed:Optional[int]`.

<Tip>The `seed` is passed into `sample` guider in the `SamplerCustomAdvanced`, but does not appear to be used in any of the standard guiders.
It is Optional, so you can generally set it to None.</Tip>

When noise is to be added, the latent is passed into this method, which should return a `Tensor` of the same shape containing the noise.

See the [noise mixing example](./snippets#creating-noise-variations)

### Sampler

The `SAMPLER` datatype represents a sampler, which is represented as a Python object providing a `sample` method.
Stable diffusion sampling is beyond the scope of this guide; see `comfy/samplers.py` if you want to dig into this part of the code.

### Sigmas

The `SIGMAS` datatypes represents the values of sigma before and after each step in the sampling process, as produced by a scheduler.
This is represented as a one-dimensional tensor, of length `steps+1`, where each element represents the noise expected to be present
before the corresponding step, with the final value representing the noise present after the final step.

A `normal` scheduler, with 20 steps and denoise of 1, for an SDXL model, produces:

```
tensor([14.6146, 10.7468,  8.0815,  6.2049,  4.8557,  
         3.8654,  3.1238,  2.5572,  2.1157,  1.7648,  
         1.4806,  1.2458,  1.0481,  0.8784,  0.7297,  
         0.5964,  0.4736,  0.3555,  0.2322,  0.0292,  0.0000])
```

<Tip>The starting value of sigma depends on the model, which is why a scheduler node requires a `MODEL` input to produce a SIGMAS output</Tip>

### Guider

A `GUIDER` is a generalisation of the denoising process, as 'guided' by a prompt or any other form of conditioning. In Comfy the guider is
represented by a `callable` Python object providing a `__call__(*args, **kwargs)` method which is called by the sample.

The `__call__` method takes (in `args[0]`) a batch of noisy latents (tensor `[B,C,H,W]`), and returns a prediction of the noise (a tensor of the same shape).

## Model datatypes

There are a number of more technical datatypes for stable diffusion models. The most significant ones are `MODEL`, `CLIP`, `VAE` and `CONDITIONING`.
Working with these is (for the time being) beyond the scope of this guide! {/* TODO but maybe not forever */}

## Additional Parameters

Below is a list of officially supported keys that can be used in the 'extra options' portion of an input definition.

<Warning>You can use additional keys for your own custom widgets, but should *not* reuse any of the keys below for other purposes.</Warning>

{/* TODO -- did I actually get everything? */}

| Key              | Description                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `default`        | The default value of the widget                                                                                                                                                                  |
| `min`            | The minimum value of a number (`FLOAT` or `INT`)                                                                                                                                                 |
| `max`            | The maximum value of a number (`FLOAT` or `INT`)                                                                                                                                                 |
| `step`           | The amount to increment or decrement a widget                                                                                                                                                    |
| `label_on`       | The label to use in the UI when the bool is `True` (`BOOL`)                                                                                                                                      |
| `label_off`      | The label to use in the UI when the bool is `False` (`BOOL`)                                                                                                                                     |
| `defaultInput`   | Defaults to an input socket rather than a supported widget                                                                                                                                       |
| `forceInput`     | `defaultInput` and also don't allow converting to a widget                                                                                                                                       |
| `multiline`      | Use a multiline text box (`STRING`)                                                                                                                                                              |
| `placeholder`    | Placeholder text to display in the UI when empty (`STRING`)                                                                                                                                      |
| `dynamicPrompts` | Causes the front-end to evaluate dynamic prompts                                                                                                                                                 |
| `lazy`           | Declares that this input uses [Lazy Evaluation](./lazy_evaluation)                                                                                                                               |
| `rawLink`        | When a link exists, rather than receiving the evaluated value, you will receive the link (i.e. `["nodeId", <outputIndex>]`). Primarily useful when your node uses [Node Expansion](./expansion). |


# Images, Latents, and Masks

When working with these datatypes, you will need to know about the `torch.Tensor` class.
Complete documentation is [here](https://pytorch.org/docs/stable/tensors.html), or
an introduction to the key concepts required for Comfy [here](./tensors).

<Warning>If your node has a single output which is a tensor, remember to return `(image,)` not `(image)`</Warning>

Most of the concepts below are illustrated in the [example code snippets](./snippets).

## Images

An IMAGE is a `torch.Tensor` with shape `[B,H,W,C]`, `C=3`. If you are going to save or load images, you will
need to convert to and from `PIL.Image` format - see the code snippets below! Note that some `pytorch` operations
offer (or expect) `[B,C,H,W]`, known as 'channel first', for reasons of computational efficiency. Just be careful.

### Working with PIL.Image

If you want to load and save images, you'll want to use PIL:

```python
from PIL import Image, ImageOps
```

## Masks

A MASK is a `torch.Tensor` with shape `[B,H,W]`.
In many contexts, masks have binary values (0 or 1), which are used to indicate which pixels should undergo specific operations.
In some cases values between 0 and 1 are used indicate an extent of masking, (for instance, to alter transparency, adjust filters, or composite layers).

### Masks from the Load Image Node

The `LoadImage` node uses an image's alpha channel (the "A" in "RGBA") to create MASKs.
The values from the alpha channel are normalized to the range \[0,1] (torch.float32) and then inverted.
The `LoadImage` node always produces a MASK output when loading an image. Many images (like JPEGs) don't have an alpha channel.
In these cases, `LoadImage` creates a default mask with the shape `[1, 64, 64]`.

### Understanding Mask Shapes

In libraries like `numpy`, `PIL`, and many others, single-channel images (like masks) are typically represented as 2D arrays, shape `[H,W]`.
This means the `C` (channel) dimension is implicit, and thus unlike IMAGE types, batches of MASKs have only three dimensions: `[B, H, W]`.
It is not uncommon to encounter a mask which has had the `B` dimension implicitly squeezed, giving a tensor `[H,W]`.

To use a MASK, you will often have to match shapes by unsqueezing to produce a shape `[B,H,W,C]` with `C=1`
To unsqueezing the `C` dimension, so you should `unsqueeze(-1)`, to unsqueeze `B`, you `unsqueeze(0)`.
If your node receives a MASK as input, you would be wise to always check `len(mask.shape)`.

## Latents

A LATENT is a `dict`; the latent sample is referenced by the key `samples` and has shape `[B,C,H,W]`, with `C=4`.

<Tip>LATENT is channel first, IMAGE is channel last</Tip>

# Hidden and Flexible inputs

## Hidden inputs

Alongside the `required` and `optional` inputs, which create corresponding inputs or widgets on the client-side,
there are three `hidden` input options which allow the custom node to request certain information from the server.

These are accessed by returning a value for `hidden` in the `INPUT_TYPES` `dict`, with the signature `dict[str,str]`,
containing one or more of `PROMPT`, `EXTRA_PNGINFO`, or `UNIQUE_ID`

```python
@classmethod
def INPUT_TYPES(s):
    return {
        "required": {...},
        "optional": {...},
        "hidden": {
            "unique_id": "UNIQUE_ID",
            "prompt": "PROMPT", 
            "extra_pnginfo": "EXTRA_PNGINFO",
        }
    }
```

### UNIQUE\_ID

`UNIQUE_ID` is the unique identifier of the node, and matches the `id` property of the node on the client side.
It is commonly used in client-server communications (see [messages](/development/comfyui-server/comms_messages#getting-node-id)).

### PROMPT

`PROMPT` is the complete prompt sent by the client to the server.
See [the prompt object](/custom-nodes/js/javascript_objects_and_hijacking#prompt) for a full description.

### EXTRA\_PNGINFO

`EXTRA_PNGINFO` is a dictionary that will be copied into the metadata of any `.png` files saved. Custom nodes can store additional
information in this dictionary for saving (or as a way to communicate with a downstream node).

<Tip>Note that if Comfy is started with the `disable_metadata` option, this data won't be saved.</Tip>

### DYNPROMPT

`DYNPROMPT` is an instance of `comfy_execution.graph.DynamicPrompt`. It differs from `PROMPT` in that it may mutate during the course of execution in response to [Node Expansion](/custom-nodes/backend/expansion).
<Tip>`DYNPROMPT` should only be used for advanced cases (like implementing loops in custom nodes).</Tip>

## Flexible inputs

### Custom datatypes

If you want to pass data between your own custom nodes, you may find it helpful to define a custom datatype. This is (almost) as simple as
just choosing a name for the datatype, which should be a unique string in upper case, such as `CHEESE`.

You can then use `CHEESE` in your node `INPUT_TYPES` and `RETURN_TYPES`, and the Comfy client will only allow `CHEESE` outputs to connect to a `CHEESE` input.
`CHEESE` can be any python object.

The only point to note is that because the Comfy client doesn't know about `CHEESE` you need (unless you define a custom widget for `CHEESE`,
which is a topic for another day), to force it to be an input rather than a widget. This can be done with the `forceInput` option in the input options dictionary:

```python
@classmethod
def INPUT_TYPES(s):
    return {
        "required": { "my_cheese": ("CHEESE", {"forceInput":True}) }
    }
```

### Wildcard inputs

```python
@classmethod
def INPUT_TYPES(s):
    return {
        "required": { "anything": ("*",{})},
    }

@classmethod
def VALIDATE_INPUTS(s, input_types):
    return True
```

The frontend allows `*` to indicate that an input can be connected to any source. Because this is not officially supported by the backend, you can skip the backend validation of types by accepting a parameter named `input_types` in your `VALIDATE_INPUTS` function. (See [VALIDATE\_INPUTS](./server_overview#validate-inputs) for more information.)
It's up to the node to make sense of the data that is passed.

### Dynamically created inputs

If inputs are dynamically created on the client side, they can't be defined in the Python source code.
In order to access this data we need an `optional` dictionary that allows Comfy to pass data with
arbitrary names. Since the Comfy server

```python
class ContainsAnyDict(dict):
    def __contains__(self, key):
        return True
...

@classmethod
def INPUT_TYPES(s):
    return {
        "required": {},
        "optional": ContainsAnyDict()
    }
...

def main_method(self, **kwargs):
    # the dynamically created input data will be in the dictionary kwargs

```

<Tip>Hat tip to rgthree for this pythonic trick!</Tip>

# Lazy Evaluation

## Lazy Evaluation

By default, all `required` and `optional` inputs are evaluated before a node can be run. Sometimes, however, an
input won't necessarily be used and evaluating it would result in unnecessary processing. Here are some examples
of nodes where lazy evaluation may be beneficial:

1. A `ModelMergeSimple` node where the ratio is either `0.0` (in which case the first model doesn't need to be loaded)
   or `1.0` (in which case the second model doesn't need to be loaded).
2. Interpolation between two images where the ratio (or mask) is either entirely `0.0` or entirely `1.0`.
3. A Switch node where one input determines which of the other inputs will be passed through.

<Tip>There is very little cost in making an input lazy. If it's something you can do, you generally should.</Tip>

### Creating Lazy Inputs

There are two steps to making an input a "lazy" input. They are:

1. Mark the input as lazy in the dictionary returned by `INPUT_TYPES`
2. Define a method named `check_lazy_status` (note: *not* a class method) that will be called prior to evaluation to determine if any more inputs are necessary.

To demonstrate these, we'll make a "MixImages" node that interpolates between two images according to a mask. If the entire mask is `0.0`, we don't need to evaluate any part of the tree leading up to the second image. If the entire mask is `1.0`, we can skip evaluating the first image.

#### Defining `INPUT_TYPES`

Declaring that an input is lazy is as simple as adding a `lazy: True` key-value pair to the input's options dictionary.

```python
@classmethod
def INPUT_TYPES(cls):
    return {
        "required": {
            "image1": ("IMAGE",{"lazy": True}),
            "image2": ("IMAGE",{"lazy": True}),
            "mask": ("MASK",),
        },
    }
```

In this example, `image1` and `image2` are both marked as lazy inputs, but `mask` will always be evaluated.

#### Defining `check_lazy_status`

A `check_lazy_status` method is called if there are one or more lazy inputs that are not yet available. This method receives the same arguments as the standard execution function. All available inputs are passed in with their final values while unavailable lazy inputs have a value of `None`.

The responsibility of the `check_lazy_status` function is to return a list of the names of any lazy inputs that are needed to proceed. If all lazy inputs are available, the function should return an empty list.

Note that `check_lazy_status` may be called multiple times. (For example, you might find after evaluating one lazy input that you need to evaluate another.)

<Tip>Note that because the function uses actual input values, it is *not* a class method.</Tip>

```python
def check_lazy_status(self, mask, image1, image2):
    mask_min = mask.min()
    mask_max = mask.max()
    needed = []
    if image1 is None and (mask_min != 1.0 or mask_max != 1.0):
        needed.append("image1")
    if image2 is None and (mask_min != 0.0 or mask_max != 0.0):
        needed.append("image2")
    return needed
```

### Full Example

```python
class LazyMixImages:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image1": ("IMAGE",{"lazy": True}),
                "image2": ("IMAGE",{"lazy": True}),
                "mask": ("MASK",),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "mix"

    CATEGORY = "Examples"

    def check_lazy_status(self, mask, image1, image2):
        mask_min = mask.min()
        mask_max = mask.max()
        needed = []
        if image1 is None and (mask_min != 1.0 or mask_max != 1.0):
            needed.append("image1")
        if image2 is None and (mask_min != 0.0 or mask_max != 0.0):
            needed.append("image2")
        return needed

    # Not trying to handle different batch sizes here just to keep the demo simple
    def mix(self, mask, image1, image2):
        mask_min = mask.min()
        mask_max = mask.max()
        if mask_min == 0.0 and mask_max == 0.0:
            return (image1,)
        elif mask_min == 1.0 and mask_max == 1.0:
            return (image2,)

        result = image1 * (1. - mask) + image2 * mask,
        return (result[0],)
```

## Execution Blocking

While Lazy Evaluation is the recommended way to "disable" part of a graph, there are times when you want to disable an `OUTPUT` node that doesn't implement lazy evaluation itself. If it's an output node that you developed yourself, you should just add lazy evaluation as follows:

1. Add a required (if this is a new node) or optional (if you care about backward compatibility) input for `enabled` that defaults to `True`
2. Make all other inputs `lazy` inputs
3. Only evaluate the other inputs if `enabled` is `True`

If it's not a node you control, you can make use of a `comfy_execution.graph.ExecutionBlocker`. This special object can be returned as an output from any socket. Any nodes which receive an `ExecutionBlocker` as input will skip execution and return that `ExecutionBlocker` for any outputs.

<Tip>**There is intentionally no way to stop an ExecutionBlocker from propagating forward.** If you think you want this, you should really be using Lazy Evaluation.</Tip>

### Usage

There are two ways to construct and use an `ExecutionBlocker`

1. Pass `None` into the constructor to silently block execution. This is useful for cases where blocking execution is part of a successful run -- like disabling an output.

```python
def silent_passthrough(self, passthrough, blocked):
    if blocked:
        return (ExecutionBlocker(None),)
    else:
        return (passthrough,)
```

2. Pass a string into the constructor to display an error message when a node is blocked due to receiving the object. This can be useful if you want to display a meaningful error message if someone uses a meaningless output -- for example, the `VAE` output when loading a model that doesn't contain VAEs.

```python
def load_checkpoint(self, ckpt_name):
    ckpt_path = folder_paths.get_full_path("checkpoints", ckpt_name)
    model, clip, vae = load_checkpoint(ckpt_path)
    if vae is None:
        # This error is more useful than a "'NoneType' has no attribute" error
        # in a later node
        vae = ExecutionBlocker(f"No VAE contained in the loaded model {ckpt_name}")
    return (model, clip, vae)
```

# Node Expansion

## Node Expansion

Normally, when a node is executed, that execution function immediately returns the output results of that node. "Node Expansion" is a relatively advanced technique that allows nodes to return a new subgraph of nodes that should take its place in the graph. This technique is what allows custom nodes to implement loops.

### A Simple Example

First, here's a simple example of what node expansion looks like:

<Tip>We highly recommend using the `GraphBuilder` class when creating subgraphs. It isn't mandatory, but it prevents you from making many easy mistakes.</Tip>

```python
def load_and_merge_checkpoints(self, checkpoint_path1, checkpoint_path2, ratio):
    from comfy_execution.graph_utils import GraphBuilder # Usually at the top of the file
    graph = GraphBuilder()
    checkpoint_node1 = graph.node("CheckpointLoaderSimple", checkpoint_path=checkpoint_path1)
    checkpoint_node2 = graph.node("CheckpointLoaderSimple", checkpoint_path=checkpoint_path2)
    merge_model_node = graph.node("ModelMergeSimple", model1=checkpoint_node1.out(0), model2=checkpoint_node2.out(0), ratio=ratio)
    merge_clip_node = graph.node("ClipMergeSimple", clip1=checkpoint_node1.out(1), clip2=checkpoint_node2.out(1), ratio=ratio)
    return {
        # Returning (MODEL, CLIP, VAE) outputs
        "result": (merge_model_node.out(0), merge_clip_node.out(0), checkpoint_node1.out(2)),
        "expand": graph.finalize(),
    }
```

While this same node could previously be implemented by manually calling into ComfyUI internals, using expansion means that each subnode will be cached separately (so if you change `model2`, you don't have to reload `model1`).

### Requirements

In order to perform node expansion, a node must return a dictionary with the following keys:

1. `result`: A tuple of the outputs of the node. This may be a mix of finalized values (like you would return from a normal node) and node outputs.
2. `expand`: The finalized graph to perform expansion on. See below if you are not using the `GraphBuilder`.

#### Additional Requirements if not using GraphBuilder

The format expected from the `expand` key is the same as the ComfyUI API format. The following requirements are handled by the `GraphBuilder`, but must be handled manually if you choose to forego it:

1. Node IDs must be unique across the entire graph. (This includes between multiple executions of the same node due to the use of lists.)
2. Node IDs must be deterministic and consistent between multiple executions of the graph (including partial executions due to caching).

Even if you don't want to use the `GraphBuilder` for actually building the graph (e.g. because you're loading the raw json of the graph from a file), you can use the `GraphBuilder.alloc_prefix()` function to generate a prefix and `comfy.graph_utils.add_graph_prefix` to fix existing graphs to meet these requirements.

### Efficient Subgraph Caching

While you can pass non-literal inputs to nodes within the subgraph (like torch tensors), this can inhibit caching *within* the subgraph. When possible, you should pass links to subgraph objects rather than the node itself. (You can declare an input as a `rawLink` within the input's [Additional Parameters](./datatypes#additional-parameters) to do this easily.)

# Data lists

## Length one processing

Internally, the Comfy server represents data flowing from one node to the next as a Python `list`, normally length 1, of the relevant datatype.
In normal operation, when a node returns an output, each element in the output `tuple` is separately wrapped in a list (length 1); then when the
next node is called, the data is unwrapped and passed to the main function.

<Tip>You generally don't need to worry about this, since Comfy does the wrapping and unwrapping.</Tip>

<Tip>This isn't about batches. A batch (of, for instance, latents, or images) is a *single entry* in the list (see [tensor datatypes](./images_and_masks))</Tip>

## List processing

In some circumstance, multiple data instances are processed in a single workflow, in which case the internal data will be a list containing the data instances.
An example of this might be processing a series of images one at a time to avoid running out of VRAM, or handling images of different sizes.

By default, Comfy will process the values in the list sequentially:

* if the inputs are `list`s of different lengths, the shorter ones are padded by repeating the last value
* the main method is called once for each value in the input lists
* the outputs are `list`s, each of which is the same length as the longest input

The relevant code can be found in the method `map_node_over_list` in `execution.py`.

However, as Comfy wraps node outputs into a `list` of length one, if the `tuple` returned by
a custom node contains a `list`, that `list` will be wrapped, and treated as a single piece of data.
In order to tell Comfy that the list being returned should not be wrapped, but treated as a series of data for sequential processing,
the node should provide a class attribute `OUTPUT_IS_LIST`, which is a `tuple[bool]`, of the same length as `RETURN_TYPES`, specifying
which outputs which should be so treated.

A node can also override the default input behaviour and receive the whole list in a single call. This is done by setting a class attribute
`INPUT_IS_LIST` to `True`.

Here's a (lightly annotated) example from the built in nodes - `ImageRebatch` takes one or more batches of images (received as a list, because `INPUT_IS_LIST - True`)
and rebatches them into batches of the requested size.

<Tip>`INPUT_IS_LIST` is node level - all inputs get the same treatment. So the value of the `batch_size` widget is given by `batch_size[0]`.</Tip>

```Python

class ImageRebatch:
    @classmethod
    def INPUT_TYPES(s):
        return {"required": { "images": ("IMAGE",),
                              "batch_size": ("INT", {"default": 1, "min": 1, "max": 4096}) }}
    RETURN_TYPES = ("IMAGE",)
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True, )
    FUNCTION = "rebatch"
    CATEGORY = "image/batch"

    def rebatch(self, images, batch_size):
        batch_size = batch_size[0]    # everything comes as a list, so batch_size is list[int]

        output_list = []
        all_images = []
        for img in images:                    # each img is a batch of images
            for i in range(img.shape[0]):     # each i is a single image
                all_images.append(img[i:i+1])

        for i in range(0, len(all_images), batch_size): # take batch_size chunks and turn each into a new batch
            output_list.append(torch.cat(all_images[i:i+batch_size], dim=0))  # will die horribly if the image batches had different width or height!

        return (output_list,)
```

#### INPUT\_IS\_LIST

# Annotated Examples

A growing collection of fragments of example code...

## Images and Masks

### Load an image

Load an image into a batch of size 1 (based on `LoadImage` source code in `nodes.py`)

```python
i = Image.open(image_path)
i = ImageOps.exif_transpose(i)
if i.mode == 'I':
    i = i.point(lambda i: i * (1 / 255))
image = i.convert("RGB")
image = np.array(image).astype(np.float32) / 255.0
image = torch.from_numpy(image)[None,]
```

### Save an image batch

Save a batch of images (based on `SaveImage` source code in `nodes.py`)

```python
for (batch_number, image) in enumerate(images):
    i = 255. * image.cpu().numpy()
    img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
    filepath = # some path that takes the batch number into account
    img.save(filepath)
```

### Invert a mask

Inverting a mask is a straightforward process. Since masks are normalised to the range \[0,1]:

```python
mask = 1.0 - mask
```

### Convert a mask to Image shape

```Python
# We want [B,H,W,C] with C = 1
if len(mask.shape)==2: # we have [H,W], so insert B and C as dimension 1
    mask = mask[None,:,:,None]
elif len(mask.shape)==3 and mask.shape[2]==1: # we have [H,W,C]
    mask = mask[None,:,:,:]
elif len(mask.shape)==3:                      # we have [B,H,W]
    mask = mask[:,:,:,None]
```

### Using Masks as Transparency Layers

When used for tasks like inpainting or segmentation, the MASK's values will eventually be rounded to the nearest integer so that they are binary — 0 indicating regions to be ignored and 1 indicating regions to be targeted. However, this doesn't happen until the MASK is passed to those nodes. This flexibility allows you to use MASKs as you would in digital photography contexts as a transparency layer:

```python
# Invert mask back to original transparency layer
mask = 1.0 - mask

# Unsqueeze the `C` (channels) dimension
mask = mask.unsqueeze(-1)

# Concatenate ("cat") along the `C` dimension
rgba_image = torch.cat((rgb_image, mask), dim=-1)
```

## Noise

### Creating noise variations

Here's an example of creating a noise object which mixes the noise from two sources. This could be used to create slight noise variations by varying `weight2`.

```python
class Noise_MixedNoise:
    def __init__(self, nosie1, noise2, weight2):
        self.noise1  = noise1
        self.noise2  = noise2
        self.weight2 = weight2

    @property
    def seed(self): return self.noise1.seed

    def generate_noise(self, input_latent:torch.Tensor) -> torch.Tensor:
        noise1 = self.noise1.generate_noise(input_latent)
        noise2 = self.noise2.generate_noise(input_latent)
        return noise1 * (1.0-self.weight2) + noise2 * (self.weight2)
```

# Working with torch.Tensor

## pytorch, tensors, and torch.Tensor

All the core number crunching in Comfy is done by [pytorch](https://pytorch.org/). If your custom nodes are going
to get into the guts of stable diffusion you will need to become familiar with this library, which is way beyond
the scope of this introduction.

However, many custom nodes will need to manipulate images, latents and masks, each of which are represented internally
as `torch.Tensor`, so you'll want to bookmark the
[documentation for torch.Tensor](https://pytorch.org/docs/stable/tensors.html).

### What is a Tensor?

`torch.Tensor` represents a tensor, which is the mathematical generalization of a vector or matrix to any number of dimensions.
A tensor's *rank* is the number of dimensions it has (so a vector has *rank* 1, a matrix *rank* 2); its *shape* describes the
size of each dimension.

So an RGB image (of height H and width W) might be thought of as three arrays (one for each color channel), each measuring H x W,
which could be represented as a tensor with *shape* `[H,W,3]`. In Comfy images almost always come in a batch (even if the batch
only contains a single image). `torch` always places the batch dimension first, so Comfy images have *shape* `[B,H,W,3]`, generally
written as `[B,H,W,C]` where C stands for Channels.

### squeeze, unsqueeze, and reshape

If a tensor has a dimension of size 1 (known as a collapsed dimension), it is equivalent to the same tensor with that dimension removed
(a batch with 1 image is just an image). Removing such a collapsed dimension is referred to as squeezing, and
inserting one is known as unsqueezing.

<Warning>Some torch code, and some custom node authors, will return a squeezed tensor when a dimension is collapsed - such
as when a batch has only one member. This is a common cause of bugs!</Warning>

To represent the same data in a different shape is referred to as reshaping. This often requires you to know
the underlying data structure, so handle with care!

### Important notation

`torch.Tensor` supports most Python slice notation, iteration, and other common list-like operations. A tensor
also has a `.shape` attribute which returns its size as a `torch.Size` (which is a subclass of `tuple` and can
be treated as such).

There are some other important bits of notation you'll often see (several of these are less common
standard Python notation, seen much more frequently when dealing with tensors)

* `torch.Tensor` supports the use of `None` in slice notation
  to indicate the insertion of a dimension of size 1.

* `:` is frequently used when slicing a tensor; this simply means 'keep the whole dimension'.
  It's like using `a[start:end]` in Python, but omitting the start point and end point.

* `...` represents 'the whole of an unspecified number of dimensions'. So `a[0, ...]` would extract the first
  item from a batch regardless of the number of dimensions.

* in methods which require a shape to be passed, it is often passed as a `tuple` of the dimensions, in
  which a single dimension can be given the size `-1`, indicating that the size of this dimension should
  be calculated based on the total size of the data.

```python
>>> a = torch.Tensor((1,2))
>>> a.shape
torch.Size([2])
>>> a[:,None].shape 
torch.Size([2, 1])
>>> a.reshape((1,-1)).shape
torch.Size([1, 2])
```

### Elementwise operations

Many binary on `torch.Tensor` (including '+', '-', '\*', '/' and '==') are applied elementwise (independently applied to each element).
The operands must be *either* two tensors of the same shape, *or* a tensor and a scalar. So:

```python
>>> import torch
>>> a = torch.Tensor((1,2))
>>> b = torch.Tensor((3,2))
>>> a*b
tensor([3., 4.])
>>> a/b
tensor([0.3333, 1.0000])
>>> a==b
tensor([False,  True])
>>> a==1
tensor([ True, False])
>>> c = torch.Tensor((3,2,1)) 
>>> a==c
Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
RuntimeError: The size of tensor a (2) must match the size of tensor b (3) at non-singleton dimension 0
```

### Tensor truthiness

<Warning>The 'truthiness' value of a Tensor is not the same as that of Python lists.</Warning>

You may be familiar with the truthy value of a Python list as `True` for any non-empty list, and `False` for `None` or `[]`.
By contrast A `torch.Tensor` (with more than one elements) does not have a defined truthy value. Instead you need to use
`.all()` or `.any()` to combine the elementwise truthiness:

```python
>>> a = torch.Tensor((1,2))
>>> print("yes" if a else "no")
Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
RuntimeError: Boolean value of Tensor with more than one value is ambiguous
>>> a.all()
tensor(False)
>>> a.any()
tensor(True)
```

This also means that you need to use `if a is not None:` not `if a:` to determine if a tensor variable has been set.
