import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  /**
   * 只把版本号这一个字符串注入客户端。
   * 若在组件里直接 `import package.json`，整个文件（依赖列表、描述等）
   * 都会被打进浏览器包，没必要也没好处。
   */
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  /**
   * 开发时用 127.0.0.1 访问会被当成跨源请求，HMR 与客户端脚本被拦掉导致页面不水合，
   * 表现为整页点了没反应，这里把本机地址放行。
   */
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    serverActions: {
      /**
       * 备份导入走 server action 上传文件，默认上限 1MB 对数据量大的库偏小，
       * 调大以免导入时直接报「Body exceeded」而不是给出可读的错误。
       */
      bodySizeLimit: "32mb",
    },
  },
};

export default nextConfig;
