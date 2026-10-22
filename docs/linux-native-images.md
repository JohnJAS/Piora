# Linux Electron 原生图片兼容性

对应 [#190](https://github.com/kexijiang/Piora/issues/190)。Linux Electron 加载系统 GLib，而 sharp 的预编译 libvips 携带自己的 GLib。sharp 原生插件对 `g_object_ref`、`g_object_unref` 等函数的动态引用可能落到系统副本，导致对象状态错误或原生崩溃。

`scripts/patch-sharp-electron-linux.mjs` 在正常 `npm ci` / `npm install` 的 postinstall 中运行。它读取 sharp 原生插件的 GLib 引用，只将这些引用及 libvips 的对应导出一起改为 `piora_g_*`。其余符号、默认动态加载方式、Electron 内存分配器及 JS API 保持原状。Windows 和非 glibc 的依赖不做此修改。

补丁覆盖实际应用依赖；standalone staging 会复制修改后的完整包，`@img` 原生库继续存放在 `runtime.asar.unpacked`。运行发布包不需要 ELF 编辑工具，也不需要用户安装系统 libvips。升级 sharp 0.35.5 / libvips 包 1.3.4 时，版本校验会要求重新评审补丁。

## 开发与构建

Linux 安装依赖前需要 `binutils` 和 PATH 中的 patchelf 0.19.2+。CI 与发布共用 `.github/actions/setup-linux-native-image-tools`，固定官方 0.19.2 下载地址并校验 SHA-256。不要使用 Ubuntu 24.04 自带的 patchelf 0.18：其 [DT_INIT 重定位缺陷](https://github.com/NixOS/patchelf/issues/639) 会使重写后的库在普通 Node 初始化时也崩溃。

```sh
npm ci
node scripts/diagnose-sharp-electron.mjs
node --test lib/image-packaging.test.mjs lib/sharp-electron-linux.test.mjs
```

诊断脚本只在临时副本中还原原始 GLib 符号，不修改已安装依赖。它分别测试普通 Node、Electron 目录和 Electron ASAR；ASAR 验证前删除源目录，防止依赖回退。每条路径执行真实 PNG 生成、尺寸与像素验证及连续解码。原始副本的失败作为对照记录，任一修复后路径失败都会让命令失败。即使退出码为零，GLib critical/warning 也会判为失败。

## 已验证与边界

[2026-10-22 Linux 专项运行](https://github.com/JohnJAS/Piora/actions/runs/39771245181) 使用 Ubuntu 24.04、Node 22.19.0、Electron 44.9.0、sharp 0.35.5、libvips 8.18.7：原始普通 Node 通过；原始 Electron 目录及 ASAR 路径出现 GLib-GObject critical；符号隔离后的三条路径和打包图片测试全部通过。该轮原始副本退出码为零，没有再次观察到 SIGSEGV，因此不能把崩溃描述为每次必现。

Windows 本机 Electron 44.9.0 的目录和 ASAR 图片回归通过。专项通过不等于完整 CI、Linux 发布包安装或所有图片格式的实机验收。

排查时也验证过 `RTLD_DEEPBIND`：在本项目 Linux Electron 下触发 invalid pointer / SIGABRT，因此没有采用该方案，也没有使用 `LD_PRELOAD` 或屏蔽原生失败。
