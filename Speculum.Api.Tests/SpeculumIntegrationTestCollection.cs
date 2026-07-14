namespace Speculum.Api.Tests;

/// <summary>
/// Serializes integration tests that spin up Kestrel hosts.
/// DisableParallelization avoids cross-factory env mutation races
/// (multiple SpeculumWebApplicationFactory instances rewriting process env).
/// </summary>
[CollectionDefinition(nameof(SpeculumIntegrationTestCollection), DisableParallelization = true)]
public sealed class SpeculumIntegrationTestCollection : ICollectionFixture<SpeculumWebApplicationFactory>;
