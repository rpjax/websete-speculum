#pragma once

#include <string>
#include <unordered_map>

#include "domain/Result.hpp"
#include "domain/fault/Fault.hpp"
#include "domain/oracle/Types.hpp"
#include "domain/producer/LiveDescriptor.hpp"
#include "domain/producer/RowDescriptor.hpp"
#include "engines/sim/SimDocument.hpp"
#include "engines/sim/SimEngine.hpp"
#include "engines/sim/SimStateFreezer.hpp"
#include "ports/IStateCapture.hpp"

namespace speculum::sim {

// Capture under a valid FreezeToken only.
// Wire CaptureKind::Rebuilt ≡ captureLive (dVN dump) until schema rename.
class SimStateCapture final : public IStateCapture {
 public:
  SimStateCapture(SimEngine& eng, SimStateFreezer& freezer)
      : eng_(eng), freezer_(freezer) {}

  Result<oracle::TableImage> captureTable(oracle::FreezeToken tok,
                                          HostId host) override {
    if (!freezer_.isValid(tok)) {
      return Result<oracle::TableImage>::failure(fault::makeFault(
          fault::FaultCode::StaleFreezeToken, "SimStateCapture", "captureTable"));
    }
    auto* prod = producerFor(host);
    if (!prod) {
      return Result<oracle::TableImage>::failure(fault::makeFault(
          fault::FaultCode::CaptureUnavailable, "SimStateCapture", "no producer"));
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

  Result<oracle::NaiveImage> captureNaive(oracle::FreezeToken tok,
                                          HostId host) override {
    if (!freezer_.isValid(tok)) {
      return Result<oracle::NaiveImage>::failure(fault::makeFault(
          fault::FaultCode::StaleFreezeToken, "SimStateCapture", "captureNaive"));
    }
    auto* doc = eng_.simDocumentOf(host);
    auto* prod = producerFor(host);
    if (!doc || !prod) {
      return Result<oracle::NaiveImage>::failure(fault::makeFault(
          fault::FaultCode::CaptureUnavailable, "SimStateCapture", "no doc"));
    }
    oracle::NaiveImage img;
    img.host = host;
    auto& view = doc->mutableView();
    view.forEachNode([&](NodeRef href) {
      oracle::ImageNode n;
      n.id = prod->identity().lookup(href.value(), producer::KeySpace::Node);
      if (!n.id && href.valid())
        n.id = prod->identity().assign(href.value(), producer::KeySpace::Node);
      n.kind = view.kind(href);
      n.ns = view.ns(href);
      n.name = std::string(view.localName(href));
      n.value = std::string(view.characterData(href));
      auto p = view.parent(href);
      n.parent = p.valid() ? prod->identity().lookup(p.value(), producer::KeySpace::Node) : 0;
      // prev sibling
      if (p.valid()) {
        uint32_t cn = view.childCount(p);
        NodeRef prev{};
        for (uint32_t i = 0; i < cn; ++i) {
          auto c = view.childAt(p, i);
          if (c == href) {
            n.prevSibling =
                prev.valid() ? prod->identity().lookup(prev.value(), producer::KeySpace::Node) : 0;
            break;
          }
          prev = c;
        }
      }
      uint32_t ac = view.attrCount(href);
      for (uint32_t i = 0; i < ac; ++i) {
        std::string_view an, av;
        view.attrAt(href, i, an, av);
        n.attrs[std::string(an)] = std::string(av);
      }
      n.userAgentOwned = view.isUserAgentOwned(href);
      img.nodes.push_back(std::move(n));
    });
    return Result<oracle::NaiveImage>::success(std::move(img));
  }

  // Live descriptors d(VN) — maps to wire CaptureKind::Rebuilt until schema aligns.
  Result<oracle::DescriptorImage> captureLive(oracle::FreezeToken tok,
                                              HostId host) override {
    if (!freezer_.isValid(tok)) {
      return Result<oracle::DescriptorImage>::failure(fault::makeFault(
          fault::FaultCode::StaleFreezeToken, "SimStateCapture", "captureLive"));
    }
    auto* doc = eng_.simDocumentOf(host);
    auto* prod = producerFor(host);
    if (!doc || !prod) {
      return Result<oracle::DescriptorImage>::failure(fault::makeFault(
          fault::FaultCode::CaptureUnavailable, "SimStateCapture", "no doc"));
    }
    oracle::DescriptorImage img;
    img.host = host;
    img.generation = prod->documentId().generation;
    auto& view = doc->mutableView();
    view.forEachNode([&](NodeRef href) {
      producer::LiveDescriptor live(prod->view(), prod->identity(), href);
      oracle::ImageNode n;
      n.id = live.id();
      n.kind = live.kind();
      n.ns = live.ns();
      n.name = std::string(live.name());
      n.value = std::string(view.characterData(href));
      n.parent = live.parent();
      n.prevSibling = live.prevSibling();
      n.contentHash = live.contentHash();
      n.rowHash = live.hash();
      uint32_t ac = view.attrCount(href);
      for (uint32_t i = 0; i < ac; ++i) {
        std::string_view an, av;
        view.attrAt(href, i, an, av);
        n.attrs[std::string(an)] = std::string(av);
        n.fieldHash["a:" + std::string(an)] = live.attr(an);
      }
      n.fieldHash["name"] = producer::hashName(n.name);
      n.fieldHash["value"] = producer::hashValue(n.value);
      n.userAgentOwned = view.isUserAgentOwned(href);
      img.nodes.push_back(std::move(n));
    });
    return Result<oracle::DescriptorImage>::success(std::move(img));
  }

 private:
  producer::Producer* producerFor(HostId host) {
    auto* doc = eng_.simDocumentOf(host);
    if (!doc) return nullptr;
    return eng_.producerOf(doc->id());
  }

  SimEngine& eng_;
  SimStateFreezer& freezer_;
};

}  // namespace speculum::sim
