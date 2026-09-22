#include "domain/fault/Fault.hpp"

namespace speculum::fault {

FaultAction actionOf(FaultCode code) {
  using C = FaultCode;
  switch (code) {
    // KillSession
    case C::FramingLost:
    case C::CeilingExceeded:
    case C::LinkBroken:
      return FaultAction::KillSession;

    // DropDocument
    case C::DocumentGone:
    case C::NoSuchDocument:
    case C::HostGone:
      return FaultAction::DropDocument;

    // DropStream
    case C::AssetOffsetGap:
    case C::AssetPhaseViolation:
    case C::AssetTooManyStreams:
    case C::AssetNotFound:
    case C::AssetForbidden:
    case C::AssetReadFailed:
      return FaultAction::DropStream;

    // Report (everything else catalogued)
    case C::WrongDirection:
    case C::MalformedFields:
    case C::ClockUnavailable:
    case C::ViewportOpenRefused:
    case C::NoSuchViewport:
    case C::NoSuchHost:
    case C::MalformedUrl:
    case C::NavigateRefused:
    case C::ResizeRefused:
    case C::StaleGeneration:
    case C::ProbeDisabled:
    case C::HaltIncomplete:
    case C::CaptureUnavailable:
    case C::StaleFreezeToken:
    case C::ResyncCheckFailed:
    case C::SnapshotTooLarge:
    case C::IdentityExhausted:
    case C::InputUnknownKind:
    case C::InputNoIdentity:
    case C::InputNodeGone:
    case C::InputNotElement:
    case C::InputHalted:
    case C::InputNoTarget:
      return FaultAction::Report;
  }
  // Unreachable if schema FaultCode is total — unknown code is a product defect.
  return FaultAction::KillSession;
}

}  // namespace speculum::fault
