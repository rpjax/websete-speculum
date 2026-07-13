namespace Speculum.Api.Tests;

/// <summary>Serializes integration tests that spin up Kestrel hosts.</summary>
[CollectionDefinition(nameof(SpeculumIntegrationTestCollection))]
public sealed class SpeculumIntegrationTestCollection : ICollectionFixture<SpeculumWebApplicationFactory>;
