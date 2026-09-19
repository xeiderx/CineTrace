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
