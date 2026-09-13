/* Shim de teste — NÃO é o nsStringFwd do Mozilla.
 *
 * O SpeculumControlAbi.cpp de produção usa exatamente três coisas de nsACString:
 * Assign(const char*, len), Length() e Data(). Este shim fornece só isso, com
 * bytes crus por baixo — o suficiente para compilar o codec REAL fora do Gecko.
 * Qualquer erro do shim aparece como divergência de byte contra o golden, então
 * o shim não pode mentir sem ser pego. */
#ifndef speculum_test_shim_nsStringFwd_h
#define speculum_test_shim_nsStringFwd_h

#include <string>
#include <cstddef>

class nsACString {
 public:
  nsACString() = default;
  explicit nsACString(const char* aData, size_t aLength) : mData(aData, aLength) {}

  void Assign(const char* aData, size_t aLength) { mData.assign(aData, aLength); }
  void Assign(const nsACString& aOther) { mData = aOther.mData; }

  size_t Length() const { return mData.size(); }
  const char* Data() const { return mData.data(); }

  bool operator==(const nsACString& aOther) const { return mData == aOther.mData; }

 private:
  std::string mData;
};

// nsCString concreto = mesmo tipo no shim; produção distingue, o codec não precisa.
using nsCString = nsACString;

#endif
