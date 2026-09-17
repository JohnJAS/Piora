# Piora Git 浏览器授权服务

此服务处理 GitHub、GitLab 和 Gitee 的 OAuth 回调与令牌交换。它只保留最多 10 分钟的待完成授权事务；授权结果由发起登录的 Piora 实例凭一次性证明领取。代码仓库内容不经过此服务。

## 配置

为每个平台注册 OAuth 应用，回调地址均填写 `https://<授权服务域名>/v1/callback`。自建 GitLab 要在该实例注册应用，并将它加入服务配置。GitHub 应用授权需仓库和组织访问范围；GitLab 需要 API 及仓库写入范围；Gitee 需要用户信息和项目范围。按平台后台实际可用的范围核对权限。

设置以下环境变量后部署 Dockerfile：

```text
PI_GIT_OAUTH_PUBLIC_URL=https://auth.example.com
PI_GIT_OAUTH_PROVIDERS_JSON=[{"id":"github","site":"https://github.com","clientId":"...","clientSecret":"...","scope":"repo read:org"},{"id":"gitlab","site":"https://gitlab.com","clientId":"...","clientSecret":"...","scope":"api read_user write_repository"},{"id":"gitee","site":"https://gitee.com","clientId":"...","clientSecret":"...","scope":"user_info projects"}]
PORT=34142
```

将 Piora 所在机器的 `PI_GIT_OAUTH_URL` 设为同一服务的 HTTPS 地址。自建 GitLab 增加一条 `id=gitlab` 且 `site` 指向该实例的配置。所有实例域名由服务管理员显式配置，客户端不能提交任意授权站点。

授权服务应置于 HTTPS 反向代理后，保护环境变量中的密钥；不要将密钥放入桌面包或仓库。服务重启会清除进行中的授权事务，用户只需重新发起登录。`GET /health` 用于存活探针。
