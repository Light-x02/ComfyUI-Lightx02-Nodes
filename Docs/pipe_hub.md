# 🔗 Pipe Hub

---

## 🧩 Description

The **🔗 Pipe Hub** is a universal node designed to **carry and merge any type of data** within ComfyUI.\
It acts as an **intelligent multiplexer**, capable of linking multiple data streams — `IMAGE`, `MASK`, `LATENT`, `VAE`, `MODEL`, etc. — inside a single, unified “pipe.”\
It helps to **keep workflows clean and readable**, avoiding messy wires crossing the workspace by grouping everything into a single organized flow.

Both **inputs and outputs** of the Pipe Hub accept any connection type (`AnyType("*")`).\
This allows you to freely connect heterogeneous nodes without worrying about data types.

---

## ⚙️ Functionality

Each **Pipe Hub** includes:

- A special input `` (connection from another Pipe Hub),
- A main output `` (to transmit data to other Pipe Hubs or nodes),
- Multiple dynamic **input/output pairs** (`in1/out1`, `in2/out2`, etc.),
- A `` button to resynchronize structure and port labels.

When a link is connected to an input (`inX`), a **new pair** is automatically added.\
Conversely, when an input becomes unused, the extra port disappears.

### 🧤 Automatic Naming

The Pipe Hub **automatically copies the names** of upstream connections.\
For example:

- If an `IMAGE` output is connected, the input will be renamed `IMAGE`.
- If multiple links of the same type are added, the names become `IMAGE`, `IMAGE_1`, `IMAGE_2`, etc.

---

## 🔁 Serial Usage

Pipe Hubs can be **chained in series**:

```
[Pipe Hub 1] → [Pipe Hub 2] → [Pipe Hub 3]
```

Each hub inherits names and types from the previous one, allowing data signals to flow seamlessly through an entire network.\
You can even **insert new links anywhere** in the chain — downstream Pipe Hubs will update automatically.

---

## 🧱 The “Fix” Button

The **Fix** button recalculates and synchronizes the entire connected network:

- Fixes missing or extra ports,
- Restores input and output names,
- Updates connected Pipe Hubs upstream and downstream.

### ⚠️ Current Limitation

The **Fix** button **does not propagate beyond a Set/Get Node** (see below).\
In other words:

> If your network contains a `SetNode` and a `GetNode`, you must click **Fix** on **both sides** of this pair to fully refresh the network.

---

## 🔌 Compatibility with SetNode / GetNode (rgthree)

The 🔗 Pipe Hub is fully compatible with the\
[`SetNode`](https://github.com/rgthree/rgthree-comfy) and [`GetNode`](https://github.com/rgthree/rgthree-comfy) nodes from the **rgthree-comfy** project.

Thanks to this compatibility:

- You can **store** a pipe using `SetNode` under a name (e.g., `pipe`),
- Then **retrieve** it later in the workflow using `GetNode`,
- While keeping the full structure and naming of the Pipe Hub intact.

---

## 🔄 Example Flow

```
[Pipe Hub A] → [SetNode (pipe)] → [GetNode (pipe)] → [Pipe Hub B]
```

- Data flows correctly between A and B through Set/Get.\


- When the flow changes, click **Fix** on A **and** on B to refresh all ports.

---

## 🧠 Usage Tips

- The Pipe Hub supports up to **30 input/output pairs** per node.\


- You can insert intermediate nodes (`Reroute`, `ControlNet`, etc.) without breaking the chain.\


- Use **Fix** after moving or deleting pipes to keep the network clean.\


- Avoid connecting multiple Pipe Hubs to the same `SetNode` key — this may cause naming conflicts.

---

## 🧩 Summary

| Function          | Description                                                      |
| ----------------- | ---------------------------------------------------------------- |
| **pipe\_in**      | Main input, receives a flow from another Pipe Hub                |
| **pipe**          | Main output, sends the complete flow to other Pipe Hubs or nodes |
| **inN / outN**    | Dynamic port pairs accepting any type                            |
| **Fix**           | Synchronizes ports and labels across the network                 |
| **Compatibility** | Reroute, Set/GetNode (rgthree), multi-chains, auto-naming        |
| **Limitation**    | Fix does not yet automatically traverse Set/GetNodes             |

---

## 🔗 Resources

- rgthree-comfy repository: [https://github.com/rgthree/rgthree-comfy](https://github.com/rgthree/rgthree-comfy)

---

