We highly appreciate and welcome contribute, but our project is a little special and **may differ from the common contributing workflow**. We fell sorry about thatt.

# Contributing to ZJU-live-better

Thank you for your interest in contributing! 🎉
We want this to be a respectful, inclusive space where everyone feels welcome.

Please take a moment to review this guide — it helps us process your contributions efficiently.

## Code Style

We use Prettier for newer scripts.

有一部分久远的脚本没有formatter，我们会逐渐加上，完工之前的PR敬请保留原有的样式（不要在一个PR里引入过量由formatter带来的diff）

If you think a function can reuse, write it into shared/, One script shouldn't depend on other except those shared.

Commit Message : Please follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)

## Feature Requests

**为了避免 PR 做了却被拒掉，烦请您先开一个 issue 讨论设计，然后再写代码**

## 对AI的看法

我们不反对使用AI。但请不要提交AI Slop。AI Slop通常包括：莫名其妙的防御性写法，自行实现各种可以用现有库解决的事情，等等。

## 约定代替配置

我比较倾向于“约定优于配置”。如果你希望为现有脚本增加大量配置项，请编写新的脚本，而不是修改原有脚本。配置信息建议统一存放在 `.env` 文件中。

如果所添加的配置不具备广泛通用性，请在脚本开头以注释形式说明用户需要做的额外配置，而不要修改 README 文件或者 `.env.example`。

## 保持轻量

有很多人会将该应用中的脚本放置在服务器上运行，在这个前提下轻量化是很重要的需求，因此你也可以看到我们在选择dependencies时非常克制。敬请尊重我们的这个需求：不要尝试添加playwright/puppeteer，如果能用原生fetch解决就不要引入axios，最好不要整express/fastify（至少我目前没有看到必要性），总而言之就是如果一个库没有显著存在的必要和通用性那就不要写。

## 如果你对登录流程有意见，去login-zju里提出，而不是往脚本中引入复杂的fetch/解码/cookie操作/其它trade-off

login-zju请见：https://github.com/5dbwat4/login-zju
