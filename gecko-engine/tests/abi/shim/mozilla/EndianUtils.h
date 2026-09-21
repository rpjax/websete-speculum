/* Shim de teste — NÃO é o EndianUtils do Mozilla.
 *
 * Little-endian byte a byte: correto independente da endianness do host, que é
 * justamente a garantia que o codec de produção espera de mozilla::LittleEndian. */
#ifndef speculum_test_shim_EndianUtils_h
#define speculum_test_shim_EndianUtils_h

#include <cstdint>

namespace mozilla {

struct LittleEndian {
  static uint16_t readUint16(const void* p) {
    const uint8_t* b = static_cast<const uint8_t*>(p);
    return static_cast<uint16_t>(b[0] | (b[1] << 8));
  }
  static uint32_t readUint32(const void* p) {
    const uint8_t* b = static_cast<const uint8_t*>(p);
    return static_cast<uint32_t>(b[0]) | (static_cast<uint32_t>(b[1]) << 8) |
           (static_cast<uint32_t>(b[2]) << 16) | (static_cast<uint32_t>(b[3]) << 24);
  }
  static int32_t readInt32(const void* p) {
    return static_cast<int32_t>(readUint32(p));
  }
  static uint64_t readUint64(const void* p) {
    const uint8_t* b = static_cast<const uint8_t*>(p);
    uint64_t v = 0;
    for (int i = 0; i < 8; ++i) v |= static_cast<uint64_t>(b[i]) << (8 * i);
    return v;
  }

  static void writeUint16(void* p, uint16_t v) {
    uint8_t* b = static_cast<uint8_t*>(p);
    b[0] = static_cast<uint8_t>(v & 0xff);
    b[1] = static_cast<uint8_t>((v >> 8) & 0xff);
  }
  static void writeUint32(void* p, uint32_t v) {
    uint8_t* b = static_cast<uint8_t*>(p);
    for (int i = 0; i < 4; ++i) b[i] = static_cast<uint8_t>((v >> (8 * i)) & 0xff);
  }
  static void writeInt32(void* p, int32_t v) {
    writeUint32(p, static_cast<uint32_t>(v));
  }
  static void writeUint64(void* p, uint64_t v) {
    uint8_t* b = static_cast<uint8_t*>(p);
    for (int i = 0; i < 8; ++i) b[i] = static_cast<uint8_t>((v >> (8 * i)) & 0xff);
  }
};

}  // namespace mozilla

#endif
