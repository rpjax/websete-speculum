#pragma once

#include <filesystem>
#include <fstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "domain/roteiro/Sha256.hpp"

namespace speculum::roteiro {

inline constexpr size_t kBlobThreshold = 256;

class BlobStore {
 public:
  explicit BlobStore(std::filesystem::path dir) : dir_(std::move(dir)) {
    std::filesystem::create_directories(dir_);
  }

  // Returns inline hex if small, or "#<sha256>" and writes blob file.
  std::string store(const std::vector<uint8_t>& bytes) {
    if (bytes.size() <= kBlobThreshold) {
      return toHex(bytes);
    }
    auto h = Sha256::hashHex(bytes);
    auto path = dir_ / (h + ".bin");
    if (!std::filesystem::exists(path)) {
      std::ofstream out(path, std::ios::binary);
      out.write(reinterpret_cast<const char*>(bytes.data()),
                static_cast<std::streamsize>(bytes.size()));
    }
    cache_[h] = bytes;
    return "#" + h;
  }

  bool resolve(std::string_view token, std::vector<uint8_t>& out) const {
    if (token.empty()) return false;
    if (token[0] == '#') {
      std::string h(token.substr(1));
      auto it = cache_.find(h);
      if (it != cache_.end()) {
        out = it->second;
        return true;
      }
      auto path = dir_ / (h + ".bin");
      std::ifstream in(path, std::ios::binary);
      if (!in) return false;
      out.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
      return Sha256::hashHex(out) == h;
    }
    return fromHex(token, out);
  }

  static std::string toHex(const std::vector<uint8_t>& b) {
    static const char* kHex = "0123456789abcdef";
    std::string s;
    s.resize(b.size() * 2);
    for (size_t i = 0; i < b.size(); ++i) {
      s[i * 2] = kHex[b[i] >> 4];
      s[i * 2 + 1] = kHex[b[i] & 0xf];
    }
    return s;
  }

  static bool fromHex(std::string_view hex, std::vector<uint8_t>& out) {
    if (hex.size() % 2) return false;
    out.clear();
    out.reserve(hex.size() / 2);
    auto nib = [](char c) -> int {
      if (c >= '0' && c <= '9') return c - '0';
      if (c >= 'a' && c <= 'f') return c - 'a' + 10;
      if (c >= 'A' && c <= 'F') return c - 'A' + 10;
      return -1;
    };
    for (size_t i = 0; i < hex.size(); i += 2) {
      int hi = nib(hex[i]), lo = nib(hex[i + 1]);
      if (hi < 0 || lo < 0) return false;
      out.push_back(uint8_t((hi << 4) | lo));
    }
    return true;
  }

 private:
  std::filesystem::path dir_;
  mutable std::unordered_map<std::string, std::vector<uint8_t>> cache_;
};

}  // namespace speculum::roteiro
