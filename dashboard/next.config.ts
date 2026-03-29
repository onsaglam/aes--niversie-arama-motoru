import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // child_process yalnızca local agent çalıştırma rotalarında kullanılır.
  // Vercel'de bu rotalar zaten devre dışı bırakılır.
  serverExternalPackages: ["child_process"],
};

export default nextConfig;
