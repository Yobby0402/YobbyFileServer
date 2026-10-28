# ASR 模型替换评估

> 调研日期：2026-10-08。仅评估，不修改业务实现，也未下载或运行新模型。公开指标不等同于本项目实测。

## 当前基线

当前语音服务使用 FunASR `AutoModel`，组合为 `SenseVoiceSmall + fsmn-vad + CAM++`。因此比较对象应当是“现有识别、切段与说话人处理链路”，而不仅是两个 ASR 权重文件。

本地代码检查结果：

- [`speech_service/server.py`](../speech_service/server.py)：`funasr.AutoModel` 加载本地三个模型，默认 `cuda:0`，开启 `output_timestamp=True`；转写采用 `language="auto"`、`use_itn=True`、VAD 合并。
- 同一文件提供 `/health`、`POST /transcribe`；返回 `text`、`duration_ms`、`segments`，分段包含 `start_ms`、`end_ms`、`speaker`、`text`，可选 `details`。这是接口和配置确认，不是分段或说话人准确率的实测。
- [`todo_audio_worker.py`](../yobboy_file_server/todo_audio_worker.py)：上传录音先经 FFmpeg 转为 16 kHz 单声道 WAV，再调用语音服务，写入会议笔记。
- [`todo_live_transcription.py`](../yobboy_file_server/todo_live_transcription.py) 与 [`todo_v2.js`](../static/js/todo_v2.js)：实时字幕是短段录音独立调用同一个离线接口；前端约 700 ms 静音或达到默认 15 秒上限时上传，每 1200 ms 轮询字幕。停止录音后仍上传完整原始录音重新转写，不是模型级流式解码。
- [`launcher.py`](../speech_service/launcher.py)：独立 Python 3.10 环境，离线安装包为 PyTorch / torchaudio 2.3.1 + CUDA 11.8；模型加载时设置 ModelScope / Hugging Face 离线模式。
- [`requirements.txt`](../speech_service/requirements.txt)：固定 `funasr==1.4.11`，约束 `transformers>=4.37,<5`。实际只读环境探测为 `torch==2.3.1+cu118`、`transformers==4.57.6`。
- [`todo_speech_service_manager.py`](../yobboy_file_server/todo_speech_service_manager.py)：默认空闲 60 秒后退出服务。较大模型可能增加下一次录音预热等待，需测冷启动，不应只测模型已加载时的推理。

## 初步结论

- **公开准确率：** Qwen3-ASR-1.7B 更值得作为高质量候选；0.6B 在较低资源要求下也有潜力，但不是所有语种和测试场景都领先。
- **工程适配和本机速度：** 现有实现已按项目接口输出，SenseVoiceSmall 的非自回归识别路径适合低延迟；本机全链路是否更快仍需实测。没有同硬件、同音频的 A/B 测试，不能宣布 Qwen 更快或更适合现有显卡。
- **功能不是一一替换：** Qwen ASR 不等于说话人分离模型；精细时间戳需要独立 ForcedAligner。替换 ASR 时仍需处理现有 VAD、说话人字段、分段和接口兼容。
- **现阶段建议：** 保留现有基线，以 Qwen3-ASR-0.6B 为本机试验候选，以 1.7B 为质量上限参考；先做可回退的 A/B 评测，再决定是否默认切换。这是工程推断，不是已经验证的结论。

## 2026-10-09 接入状态

已按用户要求接入可选择的 Qwen 后端；前面的公开评测结论与后面的独立试运行记录保留为历史依据，不代表默认模型已自动切换。

- 桌面 **文件 -> 设置 -> 语音记录 -> 识别模型** 使用文件夹按钮选择完整的原始 `Qwen3-ASR-1.7B` / `Qwen3-ASR-0.6B` 或 SenseVoiceSmall 文件夹。检查模型类型、必需文件和索引中的全部权重分片；取消选择或选到无效目录保留原值。
- 配置保存为 `[speech] model_dir`，保存后按原来的设置流程重启服务器生效。空值或重置按钮继续使用原来的 SenseVoice 缓存；本次没有自动改写用户的 `config.ini`。
- 修复设置切换时的 Windows 进程清理：停止应用服务器会同时结束它自己创建的语音子进程，避免新配置继续请求残留的旧模型。实际父子进程回归测试在修改前失败、修改后通过。
- `/health`、`/transcribe` 和 `text/duration_ms/segments` 格式保持一致。录音、上传、最终笔记及分段实时字幕的前后端代码未改变。
- Qwen 路径复用原 FSMN VAD、CAM++、FunASR 聚类和说话人平滑；先得到说话轮次，再逐段识别文字，单次文字识别上限 15 秒。没有把所有结果固定成 `SPK0`，也没有加载 ForcedAligner。
- 正式 `speech_service/.venv` 已安装 Qwen 推理依赖，未改变 `torch==2.3.1+cu118`、`torchaudio==2.3.1+cu118`、`transformers==4.57.6`。依赖仅在选择 Qwen 时安装并缓存；首次安装依赖需要网络，权重只从所选本地目录读取。
- Qwen 使用 FP16、GPU 权重预算不超过 3072 MiB，并为激活保留空闲显存；剩余权重卸载到 CPU，VAD/CAM++ 放在 CPU。pre-Ampere GPU 上仅在 Qwen 推理上下文中禁用 cuDNN，退出后恢复原值；音频编码器有限值检查阻止 NaN/Inf 继续生成。
- Qwen 不提供 SenseVoice 的情绪/声音事件标签；中文可能包含繁体，未额外引入简繁转换。段级时间仍非逐字对齐。

### 正式 HTTP 服务验证

使用缓存的公开普通话、粤语样例及二者交替拼接的 24 秒双说话人录音。服务从正式 launcher 在独立临时端口启动，完成请求后停止全部子进程；没有占用业务端口或修改业务状态文件。

| Qwen 样例 | 音频长度 | 本轮 HTTP 耗时 | 结果 |
| --- | ---: | ---: | --- |
| 普通话 | 5.616 秒 | 4.869 秒 | 正常文本，SPK0 |
| 粤语 | 5.184 秒 | 5.181 秒 | 正常文本，SPK0 |
| 交替双说话人 | 24.000 秒 | 18.989 秒 | 4 段文字，SPK0/SPK1/SPK0/SPK1 |
| 静音 | 1.000 秒 | 0.024 秒 | 空文本、空分段 |

该次服务就绪耗时 15.177 秒，已经完成依赖安装且文件缓存较热；不是首次部署耗时。另一次受并行验证影响的启动耗时 44.084 秒，不能当作固定启动保证。

默认 SenseVoice 路径也通过 HTTP 冒烟测试；后续启动就绪耗时 12.129 秒，普通话/粤语分别耗时 0.860/0.260 秒，静音返回空结果。旧的 15 秒 VAD 合并策略在该交替样例上把双说话人内容合为两段，均标记 SPK0，本次没有修改它。短样例说明 Qwen 明显更慢，不能据此保证持续实时或认定识别准确率更高。

相关设置/语音回归 27 项通过，覆盖文件夹选择/校验/持久化、禁用语音时目录失效、进程清理、原有上传和实时字幕；独立语音环境后端测试 5 项通过。额外通过正式 `save_runtime_settings/read_runtime_settings` 验证模型目录的 INI 保存和重新读取。

最终全量主应用测试为 215 项通过、1 项失败、1 个模块跳过；`test_upload_file_to_current_directory` 单独运行通过。最小组合复现确认 `routes.init_app` 把 Flask 的 `current_app` 代理覆盖为具体应用，导致随后另一测试的上传写到前一应用根目录；已确认提交的原代码也有该覆盖，本次没有改动该问题。测试退出阶段另有空服务地址触发的旧 `manager.stop` 回调异常，亦未扩大修改范围。主应用环境跳过的语音后端模块已在独立语音环境执行通过。

复现正式服务：

```powershell
& '.\speech_service\.venv\Scripts\python.exe' '.\scripts\smoke_speech_service.py' `
  --model-dir 'F:\Work\YobboyFileServer\AI\models\Qwen3-ASR-1.7B'
```

Windows 桌面设置在 760x680、620x420 布局检查通过。尚未重新打包 EXE、构建 Docker 镜像，亦未验证真实长会议、噪声、其他方言和持续并发字幕。下一步是选择模型后，用自己的会议录音验收准确率与实时延迟；安装说明与配置示例已同步。

## 2026-10-09 独立试运行记录

用户已下载原始 `Qwen/Qwen3-ASR-1.7B`，本次目标是不使用 vLLM、不加载 ForcedAligner，后续保留说话人区分和现有停顿切段字幕。以下是本机实测，更新前述仅基于公开资料的初步建议。

### 文件与环境

- 模型位于 `AI/models/Qwen3-ASR-1.7B`。两个权重分片的 SHA-256 与官方一致，其余 8 个文件的 Git blob SHA-1 与官方一致；核对的官方 revision 为 `7278e1e70fe206f11671096ffdd38061171dd6e5`。
- 权重共 708 个张量、2,349,217,408 个参数；分片索引、张量偏移与词表结构均通过检查。
- 独立测试环境为 `AI/models/_qwen_probe/.venv`，新增 `qwen-asr==0.0.6` 和 `accelerate==1.12.0` 等推理依赖；通过本地路径复用原环境的 `torch==2.3.1+cu118`、`transformers==4.57.6`。没有升级原语音环境。
- 原环境没有安装 Qwen；回归检查确认原环境的 PyTorch、CUDA 与默认 cuDNN 导入仍正常。这不等于已验证完整 SenseVoice 业务流程。

### 兼容性修复

1. 共享 PyTorch 后，新环境最初在 `shm.dll` 加载处报 WinError 126。最小复现确认原环境正常、新环境失败；为测试进程注册原环境 `Library/bin` 中的 MKL DLL 目录后，CUDA 导入通过。没有修改系统 PATH 或原环境文件。
2. 在本次 GTX 1660 SUPER / PyTorch 2.3.1 / FP16 配置下，启用 cuDNN 时音频编码器产生 NaN/Inf，中文和粤语均只返回 `!`。音频编码器有限值检查可在文字生成之前捕获此问题；仅禁用 cuDNN 后，两种样例都输出正常语言标记和文本。

禁用 cuDNN 目前只作用于检查脚本的进程，不应当据此在主应用中无条件全局禁用。正式接入时需限制影响范围，并重新验证 VAD 与说话人模型。

### 实测配置与结果

配置：FP16、batch=1、禁用 cuDNN、`device_map="auto"`；GPU 权重预算 3072 MiB，CPU 权重预算 10 GiB。实际映射为前 18 个解码层及音频编码器等在 GPU、后 10 个解码层等在 CPU。预算不是总内存硬上限，不含激活与推理工作区。

使用本机 SenseVoice 缓存中的公开短样例，语言自动识别：

| 本轮样例 | 录音长度 | 转写耗时 | RTF | 语言输出 |
| --- | ---: | ---: | ---: | --- |
| 普通话首段 | 5.616 秒 | 6.562 秒 | 1.169 | Chinese |
| 粤语 | 5.184 秒 | 5.198 秒 | 1.003 | Cantonese |
| 同一普通话重复测试 | 5.616 秒 | 3.979 秒 | 0.709 | Chinese |

- 后续启动的运行库导入和权重加载合计约 9.759 秒，其中权重加载约 3.642 秒；不是首次部署或完全冷缓存的启动保证。
- 本进程峰值 GPU tensor allocation 为 3520.7 MiB，峰值 allocator reservation 为 3540 MiB；不包含其他程序、显示和驱动占用。
- 没有人工参考文本，不能据此计算 CER/WER，也不能宣布质量优于 SenseVoice。样例文本能够正常输出，其中含繁体中文，正式接入前应确认是否需要统一简体。
- 结论：**1.7B 在当前硬件和原有 Torch/Transformers 版本上能够通过部分 CPU 权重卸载完成离线 ASR，不需要 vLLM 或 ForcedAligner。** 但首段与粤语样例 RTF 接近或超过 1，实时余量有限；结果尚未包含 VAD、说话人处理、网络、排队和前端轮询成本。
- 本次没有替换现有 `/transcribe` 服务，没有验证长录音、多说话人区分、噪声、持续字幕或多人并发。

复现入口为 [`scripts/probe_qwen_asr.py`](../scripts/probe_qwen_asr.py)，详细结果为本机生成的 [`result.json`](../AI/models/_qwen_probe/result.json)，测试环境和结果均不入库：

```powershell
& '.\AI\models\_qwen_probe\.venv\Scripts\python.exe' '.\scripts\probe_qwen_asr.py'
```

`--enable-cudnn` 仅用于重现上述本机 FP16 数值问题。下一步是在真实普通话和方言录音上确认质量与持续延迟，再接入现有语音服务，保留 CAM++ 相关流程和旧方案回退能力。

## 公开准确率

下表取自 SenseVoice 技术报告 Table 6 与 Qwen3-ASR 技术报告 Table 3；单位为错误率百分比，越低越好。[S1][Q1]

| 同名测试集 | 指标 | SenseVoiceSmall | Qwen3-ASR-0.6B | Qwen3-ASR-1.7B |
| --- | --- | ---: | ---: | ---: |
| WenetSpeech test_net | 中文 CER | 7.84 | 5.97 | 4.97 |
| WenetSpeech test_meeting | 中文 CER | 7.44 | 6.88 | 5.88 |
| LibriSpeech test-clean | 英文 WER | 3.15 | 2.11 | 1.63 |
| LibriSpeech test-other | 英文 WER | 7.18 | 4.55 | 3.38 |

**边界：这是跨论文摘录，不是同一评测程序的直接 A/B。** 两份报告没有在相同环境中互测这三个模型；其 Whisper-large-v3 基线在同名测试集上也有差异，说明规范化、解码或评测设置不能视为完全一致。数字支持“值得尝试”的趋势，不保证本项目也能获得相同提升。[S1][Q1]

AISHELL-2 不放入主表：SenseVoice 明确使用 iOS 测试集，Qwen 表格仅标 `test`。Common Voice 的版本或取样没有在两份报告中得到统一确认，也不作为严格可比证据。[S1][Q1]

2026-06-26 发布的原生 Transformers `-hf` 模型卡还列出另一套 Open ASR Leaderboard 结果，属于不同评测，不能混入上述论文表格。[Q5]

## 能力区别

| 维度 | 现有 SenseVoiceSmall | Qwen3-ASR 系列 |
| --- | --- | --- |
| 官方语种范围 | 中文、英文、粤语、日语、韩语；50+ 语种是 SenseVoiceLarge，不是 Small | 30 种语言，另列 22 种中文方言 |
| 识别方式 | 非自回归语音识别，侧重低延迟 | 音频编码器加自回归语言模型 |
| 情感和事件标记 | 内置语种、情感、音频事件等标签 | 官方 ASR 输出不提供对应的结构化情感/事件标签 |
| 精细时间戳 | 项目中的 VAD 和 FunASR 组合负责分段；不能将 VAD 边界等同于逐字对齐 | 可选独立 Qwen3-ForcedAligner-0.6B；支持 11 种语言 |
| 说话人识别/分离 | 当前链路另有 CAM++ | 官方 ASR/ForcedAligner 不能替代 CAM++ 或完整 diarization |
| 流式 | 当前前后端使用停顿切段后离线转写，不是模型级流式 | 官方 `qwen-asr` 包提供 vLLM 流式 API，但存在下述限制 |

能力来源：SenseVoice 官方 README 和模型卡 [S2][S3]；Qwen 官方 README、ASR 与 ForcedAligner 模型卡 [Q2][Q3][Q4]。关于项目分段和说话人接口的兼容性判断属于本地工程分析。

## 流式与长音频限制

- 官方 `qwen-asr` 流式 API 只支持 vLLM 后端、单条流，不支持流式强制对齐。因此“有流式 ASR”不代表能同时输出现有精细时间戳和说话人字段。[Q2][Q6]
- 流式源码每步将截至当前的累计音频 `state.audio_accum` 交给推理引擎，并使用已解码文本前缀与回退机制。不能仅凭 API 名称推断其长期会话成本固定或本机实时率已达标。[Q6]
- 论文明确存在流式准确率损失；其离线表格不能直接代表项目接入流式之后的效果。[Q1]
- 官方离线 ASR 支持长音频，但其内部通过切段完成：当前工具源码的默认 ASR 上限为每段 1200 秒，启用 ForcedAligner 后上限为每段 180 秒，合并输出时偏移时间戳。不是无限长音频一次前向推理；这是当前代码常量，不是每种硬件都能承担的长度保证。[Q6][Q9]

## 性能数据怎么理解

| 官方宣称 | 测试条件与可用结论 |
| --- | --- |
| SenseVoiceSmall：10 秒音频约 70 ms | 官方宣称来自小模型；技术报告 Table 7 说明测试采用 NVIDIA A800、batch=1。不是本机 Windows/GTX 1660 SUPER 实测。[S1][S2] |
| Qwen3-ASR-0.6B：最低首 token 延迟约 92 ms | 首 token 延迟不是整段转写完成时间，不能与上面的 70 ms 直接比较。[Q1] |
| Qwen3-ASR-0.6B：约 2000 秒音频/秒 | 论文采用 vLLM 0.14.0、CUDA Graph、BF16，约两分钟音频，在线测试并发 1-128，最佳吞吐出现在 128。未披露具体 GPU 型号；不是一条交互音频的性能保证。[Q1] |
| 原生 Transformers `torch.compile` 加速 | 2026-06-26 模型卡的约 2.4 倍 ASR 加速测试基于 NVIDIA A100、batch=4；不能照搬到旧显卡。[Q5] |

**未知：** 本机冷启动时间、单条识别延迟、完整转写 RTF、峰值显存、ForcedAligner 额外成本，以及 ASR 与现有 CAM++/VAD 共存时的资源占用。

## 本机资源与可行性

2026-10-08 使用 `nvidia-smi` 和现有语音虚拟环境只读探测：

- GPU：NVIDIA GeForce GTX 1660 SUPER，显存总量 6144 MiB（6 GiB），CUDA compute capability 7.5，驱动 591.86。
- 探测时空闲显存 3377 MiB，仅代表当时状态；不能当作部署上限或峰值测试。
- 不套用官方示例的 `bfloat16 + flash_attention_2`：FlashAttention-2 的官方支持范围为 Ampere / Ada / Hopper，Turing 不在其中。[H1]
- 当前 PyTorch 2.3.1 的 `torch.cuda.is_bf16_supported()` 返回 `True`，但检查其本地源码可见低于 SM80 时回退为“能否创建 BF16 tensor”。该返回值不能证明原生 BF16 高性能算力。FP16、普通 attention、batch=1 可作为候选实测配置，不是运行成功保证。

官方 Hugging Face 权重元数据比型号名更适合估算参数成本：[Q8]

| 模型 | 官方总参数量 | FP16 / BF16 仅参数下限 |
| --- | ---: | ---: |
| Qwen3-ASR-0.6B | 938,008,576，约 0.94B | 约 1.75 GiB |
| Qwen3-ASR-1.7B | 2,349,217,408，约 2.35B | 约 4.38 GiB |
| Qwen3-ForcedAligner-0.6B | 917,728,896，约 0.92B | 约 1.71 GiB |

下限按总参数量乘 2 字节换算；不含激活、KV cache、CUDA 工作区、音频缓存、VAD、CAM++、显示占用和框架开销。模型名中的 0.6B / 1.7B 不能当作整个多模态模型的准确总参数量。

工程推断：

- **0.6B 单独 ASR** 是本机更合理的首个候选，但是否实时、长音频是否 OOM 仍未知。
- **0.6B + ForcedAligner** 仅参数约 3.46 GiB，已经超过本次探测时的空闲显存；需释放其他占用，并评估顺序加载、CPU 对齐或不做逐字对齐等取舍。
- **1.7B 单独 ASR** 仅参数约 4.38 GiB，6 GiB 总显存的余量有限；不能保证长输入与其他模型共存。
- **1.7B + ForcedAligner 同时全量驻留 GPU** 仅参数约 6.09 GiB，超过本卡总显存，不能作为默认方案。顺序卸载、offload 或更大显存硬件是不同方案，需另测性能。
- 精确逐字时间戳不是现有接口唯一实现方式。若只保留 VAD 段级时间，可以先不加载 ForcedAligner，但不能宣称获得等价的精细对齐。

## 部署与许可证

- 截至调研日，有两条官方路线：原始 `qwen-asr` 包，以及 2026-06-26 新增的原生 Transformers `-hf` 权重。后者不能误认为只更换模型名称即可兼容旧代码。[Q2][Q5]
- 当前 `qwen-asr` 包元数据要求 Python >=3.9，固定 `transformers==4.57.6`、`accelerate==1.12.0`；vLLM 可选依赖固定 `vllm==0.14.0`。该元数据没有独立声明 PyTorch 最低版本，不能因此推断项目现有 PyTorch 必然兼容。[Q7]
- 原生 `-hf` 模型卡要求 `transformers>=5.13.0`；Transformers v5.13.0 的依赖表要求 Python >=3.10、PyTorch >=2.4。此路线同时超出现有 `<5` 约束与 PyTorch 2.3.1 版本，应放到独立候选环境评估。[Q5][H2]
- vLLM 官方安装文档要求 Linux，Windows 不提供原生支持，可走 WSL；这进一步增加当前原生 Windows 部署真流式的成本。vLLM 的一般 GPU 门槛不能保证 Qwen ASR 所需算子在本卡上可用。[H3]
- Qwen 官方仓库、ASR 和 ForcedAligner 权重标为 Apache-2.0。[Q2][Q3][Q4]
- SenseVoice 仓库当前说明源代码采用 MIT，模型权重采用单独的 FunASR 自定义协议；Hugging Face 元数据为 `license: other`。不能将代码许可证当成权重许可证。官方另有商业使用和署名要求的澄清；具体使用应核对权重协议正文。[S2][S3][S4]

## 项目迁移判断

如果后续确认迁移，最小影响范围应是独立 `speech_service`，保留 `/health`、`/transcribe`、状态文件和既有 JSON 结构，避免在主应用 Python 环境混装 GPU 依赖。

不能只把 `TODO_SPEECH_MODEL` 指向 Qwen 权重：现有构造器、`generate()` 调用、SenseVoice 控制标签清理与 `sentence_info` 解析都不适用于 Qwen 原生返回格式。还需确认：

1. 分段和时间：继续 VAD 段级时间，还是增加 ForcedAligner；秒转毫秒与合并后的偏移必须正确。
2. 说话人：保留 CAM++ 相关流程，并验证与新分段的匹配；全部填 `SPK0` 不等于保留说话人分离。
3. 附加标签：当前 `details` 会展示语种、情感、事件等信息；Qwen 不能伪造原有标签，需明确允许缺失哪些字段。
4. 实时字幕：仅替换离线模型不会消除等待停顿、分段上传与轮询的延迟。若改为真流式，将涉及服务会话和前后端协议，属于另一项开发范围。
5. 离线部署：预先缓存新权重和全部依赖，更新安装流程；不能让当前离线模式在首次加载时隐式访问网络。

当前推荐是 **保留 SenseVoiceSmall 基线，先独立评测 Qwen 0.6B，不直接整体替换**。若实际录音的质量收益明显且延迟、资源、说话人功能均达标，再决定默认模型；1.7B 优先留给更大显存环境。

## 本机 A/B 的验收建议

这是评估建议，不是已经确认或实施的开发 spec。

1. 固定同一批真实录音，覆盖安静普通话、中文会议、中文夹英文、领域术语、背景噪声、短句、静音与长录音。
2. 保存人工参考文本，采用一致的中文 CER/英文 WER 规范化；额外人工检查人名、数字、型号和幻觉。
3. 在同一硬件上分别测 SenseVoiceSmall、Qwen 0.6B，以及显存允许时的 1.7B；记录暖机前后延迟、RTF、峰值显存与失败率。
4. 质量和速度分开验收；加入 ForcedAligner 后重新测全链路，检查 `segments/start_ms/end_ms/speaker/text/details` 的兼容性。
5. 如需真流式，单独评估首段可见时间、回改文本、最终准确率和持续运行资源占用，不以离线 CER/WER 代替。

## 一手来源

- [Q1: Qwen3-ASR 技术报告，arXiv:2601.21337](https://arxiv.org/pdf/2601.21337)；重点：Table 3、2.4 Performance Analysis、4.4 Streaming Inference 和附录 D 规范化。
- [Q2: QwenLM/Qwen3-ASR 官方 README](https://github.com/QwenLM/Qwen3-ASR/blob/main/README.md)；包含 2026-01-29 首发和 2026-06-26 Transformers 更新。
- [Q3: Qwen3-ASR-0.6B 官方模型卡](https://huggingface.co/Qwen/Qwen3-ASR-0.6B)、[Qwen3-ASR-1.7B 官方模型卡](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)。
- [Q4: Qwen3-ForcedAligner-0.6B 官方模型卡](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B)。
- [Q5: Qwen3-ASR-0.6B-hf 官方模型卡](https://huggingface.co/Qwen/Qwen3-ASR-0.6B-hf/blob/main/README.md)；包含原生 Transformers 依赖、2026-06-26 评测和 A100 加速测试。
- [Q6: Qwen 官方 ASR 推理源码](https://github.com/QwenLM/Qwen3-ASR/blob/main/qwen_asr/inference/qwen3_asr.py)；重点：`transcribe`、`init_streaming_state`、`streaming_transcribe`。
- [Q7: Qwen 官方 pyproject.toml](https://github.com/QwenLM/Qwen3-ASR/blob/main/pyproject.toml)。
- [Q8: Qwen 0.6B 官方权重元数据](https://huggingface.co/api/models/Qwen/Qwen3-ASR-0.6B?blobs=true)、[1.7B 官方权重元数据](https://huggingface.co/api/models/Qwen/Qwen3-ASR-1.7B?blobs=true)、[ForcedAligner 官方权重元数据](https://huggingface.co/api/models/Qwen/Qwen3-ForcedAligner-0.6B?blobs=true)；本次核对 `safetensors.parameters.BF16` 和权重文件大小。
- [Q9: Qwen 官方推理工具源码](https://github.com/QwenLM/Qwen3-ASR/blob/main/qwen_asr/inference/utils.py)；重点：`MAX_ASR_INPUT_SECONDS` 与 `MAX_FORCE_ALIGN_INPUT_SECONDS`。
- [S1: FunAudioLLM 技术报告，arXiv:2407.04051](https://arxiv.org/pdf/2407.04051)；重点：Table 6 识别结果与 Table 7 速度测试。
- [S2: FunAudioLLM/SenseVoice 官方 README](https://github.com/FunAudioLLM/SenseVoice/blob/main/README.md)。
- [S3: SenseVoiceSmall 官方模型卡](https://huggingface.co/FunAudioLLM/SenseVoiceSmall/blob/main/README.md)。
- [S4: FunASR 模型权重协议](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE)。
- [H1: FlashAttention 官方 README](https://github.com/Dao-AILab/flash-attention/blob/main/README.md)；FlashAttention-2 NVIDIA 支持范围。
- [H2: Transformers v5.13.0 依赖表](https://github.com/huggingface/transformers/blob/v5.13.0/src/transformers/dependency_versions_table.py)。
- [H3: vLLM 官方 GPU 安装文档](https://docs.vllm.ai/en/latest/getting_started/installation/gpu/)；操作系统要求。
