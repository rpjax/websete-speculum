namespace Speculum.Api.Sessions.Models;

public sealed class Geolocation
{
    public double Latitude { get; init; }
    public double Longitude { get; init; }
    public double Accuracy { get; init; }
}
