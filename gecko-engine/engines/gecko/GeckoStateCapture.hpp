#pragma once

#include <string>

#include "domain/Result.hpp"
#include "domain/fault/Fault.hpp"
#include "domain/oracle/Types.hpp"
#include "domain/producer/LiveDescriptor.hpp"
#include "engines/gecko/GeckoEngine.hpp"
#include "engines/gecko/GeckoStateFreezer.hpp"
#include "ports/IStateCapture.hpp"

namespace speculum::gecko {

class GeckoStateCapture final : public IStateCapture {
 public:
  GeckoStateCapture(GeckoEngine& eng, GeckoStateFreezer& freezer)
      : eng_(eng), freezer_(freezer) {}

  Result<oracle::TableImage> captureTable(oracle::FreezeToken tok, HostId host) override {
    if (!freezer_.isValid(tok)) {
      return Result<oracle::TableImage>::failure(fault::makeFault(
          fault::FaultCode::StaleFreezeToken, "GeckoStateCapture", "captureTable"));
    }
    auto* prod = producerFor(host);
    if (!prod) {
      return Result<oracle::TableImage>::failure(fault::makeFault(
          fault::FaultCode::CaptureUnavailable, "GeckoStateCapture", "no producer"));
    }
    oracle::TableImage img;
    img.host = host;
    img.generation = prod->documentId().generation;
    img.sequence = prod->sequence().current();
    for (const auto& [id, row] : prod->table().rows()) {
      (void)id;
      oracle::ImageNode n;
      n.id = row.id;
      n.kind = row.kind;
      n.ns = row.ns;
      n.name = row.name;
      n.value = row.value;
      n.parent = row.parent;
      n.prevSibling = row.prevSibling;
      n.attrs = row.attrs;
      n.rowHash = row.rowHash;
      n.contentHash = row.contentHash;
      n.fieldHash = row.fieldHash;
      img.nodes.push_back(std::move(n));
    }
    return Result<oracle::TableImage>::success(std::move(img));
  }

  Result<oracle::NaiveImage> captureNaive(oracle::FreezeToken tok, HostId host) override {
    if (!freezer_.isValid(tok)) {
      return Result<oracle::NaiveImage>::failure(fault::makeFault(
          fault::FaultCode::StaleFreezeToken, "GeckoStateCapture", "captureNaive"));
    }
    auto* doc = eng_.geckoDocumentOf(host);
    auto* prod = producerFor(host);
    if (!doc || !prod) {
      return Result<oracle::NaiveImage>::failure(fault::makeFault(
          fault::FaultCode::CaptureUnavailable, "GeckoStateCapture", "no doc"));
    }
    oracle::NaiveImage img;
    img.host = host;
    walk(doc->view().root(), doc->view(), *prod, img);
    return Result<oracle::NaiveImage>::success(std::move(img));
  }

  Result<oracle::DescriptorImage> captureLive(oracle::FreezeToken tok, HostId host) override {
    if (!freezer_.isValid(tok)) {
      return Result<oracle::DescriptorImage>::failure(fault::makeFault(
          fault::FaultCode::StaleFreezeToken, "GeckoStateCapture", "captureLive"));
    }
    auto* doc = eng_.geckoDocumentOf(host);
    auto* prod = producerFor(host);
    if (!doc || !prod) {
      return Result<oracle::DescriptorImage>::failure(fault::makeFault(
          fault::FaultCode::CaptureUnavailable, "GeckoStateCapture", "no doc"));
    }
    oracle::DescriptorImage img;
    img.host = host;
    img.generation = prod->documentId().generation;
    walkLive(doc->view().root(), *prod, img);
    return Result<oracle::DescriptorImage>::success(std::move(img));
  }

 private:
  producer::Producer* producerFor(HostId host) {
    auto* doc = eng_.geckoDocumentOf(host);
    if (!doc) return nullptr;
    return eng_.producerOf(doc->id());
  }

  static void walk(NodeRef r, const IDocumentView& view, producer::Producer& prod,
                   oracle::NaiveImage& img) {
    if (!r.valid()) return;
    oracle::ImageNode n;
    n.id = prod.identity().lookup(r.value(), producer::KeySpace::Node);
    if (!n.id) n.id = prod.identity().assign(r.value(), producer::KeySpace::Node);
    n.kind = view.kind(r);
    n.name = std::string(view.localName(r));
    n.value = std::string(view.characterData(r));
    auto p = view.parent(r);
    n.parent = p.valid() ? prod.identity().lookup(p.value(), producer::KeySpace::Node) : 0;
    img.nodes.push_back(std::move(n));
    uint32_t c = view.childCount(r);
    for (uint32_t i = 0; i < c; ++i) walk(view.childAt(r, i), view, prod, img);
  }

  static void walkLive(NodeRef r, producer::Producer& prod, oracle::DescriptorImage& img) {
    if (!r.valid()) return;
    producer::LiveDescriptor live(prod.view(), prod.identity(), r);
    oracle::ImageNode n;
    n.id = live.id();
    n.kind = live.kind();
    n.name = std::string(live.name());
    n.parent = live.parent();
    n.prevSibling = live.prevSibling();
    n.contentHash = live.contentHash();
    n.rowHash = live.hash();
    img.nodes.push_back(std::move(n));
    uint32_t c = prod.view().childCount(r);
    for (uint32_t i = 0; i < c; ++i) walkLive(prod.view().childAt(r, i), prod, img);
  }

  GeckoEngine& eng_;
  GeckoStateFreezer& freezer_;
};

}  // namespace speculum::gecko
