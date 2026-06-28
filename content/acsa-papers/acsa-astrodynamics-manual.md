---
title: ACSA Astrodynamics Manual
author: Angus Mann
affiliation: Australian Crewed Spaceflight Agency
date: 2026-06-01
abstract: A practical manual giving astronauts the means to perform orbital calculations and manoeuvres by hand in the event of a guidance computer failure, covering orbital parameters, the equations of orbital motion, propulsion fundamentals, and emergency manoeuvre procedures for Earth orbit and cislunar space.
tags: [astrodynamics, orbital mechanics, spaceflight, manoeuvres, manual]
doi: ACSA-SFO-2026-001
---

<div class="doc-titleblock">
  <div class="figure-placeholder cover">ACSA Emblem</div>
  <p class="doc-subtitle">Applications of Astrodynamics For Emergency Manned Orbital Operations</p>
  <p class="doc-guide">The Official ACSA Guide to Manually Performing Orbital Manoeuvres</p>
  <p class="doc-id">ACSA-SFO-2026-001 &middot; Angus Mann</p>
  <p class="doc-quote">"Prepared for the training and qualification of ACSA flight crews"</p>
  <p class="doc-guide">Australian Crewed Spaceflight Agency<br>Canberra, ACT, Australia &middot; June 2026</p>
</div>

**Dedication**

In the hopes that it will contribute to the success and safety of their endeavours, I wish to dedicate this work to the future of Australia's crewed spaceflight program and its astronauts, whether they be military or civilian.

**Abstract**

This paper serves as a manual providing astronauts with a practical guide to performing orbital calculations and manoeuvres in the event of a guidance computer failure. It is intended for emergency in-orbit situations in which a spacecraft capable of orbital manoeuvring retains telemetry and attitude information, and its crew retains manual control. The manual explains the orbital parameters required to describe spacecraft trajectories, presents the equations required to determine them, and introduces the propulsion and spacecraft performance considerations needed to apply them in practice. It then demonstrates the applications of the material to emergency manoeuvres such as apsis changes, circularisation burns, and return planning. The document is not designed to provide a comprehensive astrodynamics textbook; it instead aims to serve as a concise operational guide giving a pilot the means to analyse their orbit and plan the in-space burns needed to execute a safe return to Earth. The manual is limited to short-duration emergency operations in Earth orbit or cislunar space and is not intended as a comprehensive treatment of interplanetary navigation or nominal mission planning.

**Definitions of Notations**

| Symbol | Meaning |
| :---- | :---- |
| *a* | semi-major axis |
| ap | apoapsis |
| ∆ | deviation or change in quantity |
| *e* | eccentricity |
| *E* | eccentric anomaly |
| ƒ | true anomaly |
| *F* | thrust |
| *i* | inclination |
| Isp | specific impulse |
| G | gravitational constant |
| g₀ | standard gravity constant |
| µ | standard gravitational parameter |
| M | mass of body |
| ṁ | mass flow rate |
| *M* | mean anomaly |
| MN | manoeuvre node |
| pe | periapsis |
| P | orbital period |
| r | altitude |
| t | time |
| *v* | velocity |
| *ω* | argument of periapsis |
| Ω | longitude of ascending node |

## 1. Introduction

The Australian Crewed Spaceflight Agency (ACSA) is the first organisation to attempt the development of a manned Australian spacecraft. Partnering with One Giant Leap Australia (OGL) and Electro Optic Systems (EOS), they are a diverse team operating from all around Australia. With the one-man Aurora capsule, they aim to send the first astronaut into space from Australian soil within a decade. This is the most ambitious mission an Australian aerospace company has ever attempted, but that is how the space industry should be functioning. If something is to go wrong during an orbital mission, this document will provide an astronaut with the necessary information for them to calculate and execute orbital manoeuvres manually. The Australian Crewed Spaceflight Agency requires their astronauts to study this manual and to ensure that the content within will do what it can to save their life in such an eventuality. Whilst there are many documents and publications available to the public that describe orbital mechanics in great detail, the majority of them focus on either planetary mechanics and the workings of our solar system, or the specifics of the engineering required for rockets and satellites to achieve particular orbits. This paper is designed to address established principles of orbital mechanics, and applies them into an emergency reference guide for in-orbit operations. needed to plot courses through space. Teaching orbital mechanics from an operator's perspective, it investigates the practical applications of astrodynamics for in-orbit scenarios, and examines how the theoretical principles are translated into operational capabilities. The information within this paper will enable the reader to become a navigator of the stars, rather than an observant astronomer. It will supply readers with knowledge of orbital dynamics to help one describe any orbit, before giving the necessary information to calculate these parameters when others are known, teach readers about the fundamental concepts of rocketry every astronaut should know, after which it will give instructions for calculating orbital manoeuvres by hand, before finally giving specific procedures for astronauts in a range of scenarios in which they might encounter a guidance computer failure. By the end of this reading, one should be able to plot spacecraft trajectories by hand, being able to get themselves home safely if they find themselves stranded in Earth orbit.

## 2. Orbital Characteristics

### 2.1 Major, Minor, and Semi-Major Axes

The most important characteristic of a spacecraft's orbit is the semi major axis, which along with eccentricity, define the apoapsis and periapsis. Fig. 1 shows the Semi Major Axis (SMA) is equal to the average of the orbit's apoapsis distance and the periapsis distance, both measured from the centre of the primary body.

<figure class="paper-figure">
  <div class="figure-placeholder">Figure</div>
  <figcaption><strong>Fig. 1</strong> Visualisation of orbital axes.</figcaption>
</figure>

Apoapsis and periapsis are the terms given for the highest and lowest altitudes in a spacecraft's orbit respectively. (Apoapsis and periapsis are generic terms for any celestial body, the specific terms for Earth orbit are apogee and perigee respectively. This manual will refer to them as apoapsis and periapsis, purely because it makes the information within applicable to cislunar navigation as well). When performing calculations for orbital manoeuvres, the apoapsis and periapsis, as previously stated, are measured from the primary body's geocentre, not above sea or ground level as they are in aviation. Also in contrast to aviation, altitude is measured in metres rather than in feet.

### 2.2 Eccentricity

While the semi-major axis establishes the scale of the orbit, the specific geometric relationship between the apoapsis and periapsis determines the overall orbital shape, leading to the concept of eccentricity. When a vessel is in a perfectly circular orbit, in that the apoapsis and periapsis are the same value, the semi-major axis is identical to the craft's orbital radius. However, a perfectly circular orbit is practically unattainable due to slight perturbations and the effects of n-body gravitation, and assuming the orbit is anything less than circular, it is described as an ellipse. Eccentricity is the measure of how elliptical the shape of the orbit is, or how different the values of the apoapsis and periapsis. A vessel's eccentricity is 0 if it is in a perfectly circular orbit, an elliptical orbit will have values between 0 and 1, a parabola's eccentricity will be exactly 1, and anything greater than 1 is hyperbolic.

### 2.3 Inclination

Once the size and shape of an orbit are defined, the next step in understanding orbital mechanics is to establish how the entire orbital trajectory is tilted in space. The inclination of an orbiting spacecraft states the angle of the orbit's plane relative to the equator. An object in a 0 degree inclination is flying west to east along the equator, in a 90 degree inclination it is orbiting along the poles, and a 180 degree inclination indicates a retrograde orbit. "A retrograde orbit is one in which a satellite moves in a direction opposite to the rotation of its primary" (Braeunig 2011). When launching into orbit, the minimum inclination achievable is limited by the latitude of the launch site, with launch locations closer to the equator generally being more fuel efficient than those of higher latitudes. However, if a satellite is to be placed into a high inclination orbit, "launch efficiency increases as launch site location moves from the equator to a latitude equal to the intended orbital inclination" (Klemen 2015).

### 2.4 Orbital Period

The combination of this tilt and the orbit's overall size fundamentally dictates the orbital period, which is simply defined as the time it takes for a satellite to return to the same point in its orbit, or in other words, the time to complete one full orbit. It should be noted that the orbital period will increase with the SMA. "The orbital period increases with [altitude](https://www.britannica.com/dictionary/altitude) for two reasons. First, as the altitude increases, Earth's gravity decreases, so the orbital velocity needed to balance it decreases. Second, the spacecraft has to travel farther to circle Earth" (Grey 2001). The orbital period value is most useful for in-space rendezvous, where it is critical to, for instance, raise one's apoapsis to the height of a target vessel so that your active spacecraft will arrive at the apoapsis and cross the target's path at the same time the target also arrives. It is also important not just for astrodynamics but for engineering, as it allows engineers to calculate, for instance, time spent in the shadow of a planet for solar powered spacecraft.

### 2.5 Longitude of the Ascending Node

To successfully coordinate such rendezvous manoeuvres in a three-dimensional environment, an astronaut must also pinpoint where this tilted orbital plane intersects the planet's primary reference plane, which is defined by the longitude of the ascending node. For vessels in orbital inclinations other than 0, the ascending and descending nodes are the points in the orbits where the object crosses the equator. As seen in Fig. 2, a spacecraft passing the ascending node begins to move the northern hemisphere, and following the passing of the descending node it crosses into the southern hemisphere.

<figure class="paper-figure">
  <div class="figure-placeholder">Figure</div>
  <figcaption><strong>Fig. 2</strong> Diagram of an orbit's ascending node and inclination.</figcaption>
</figure>

The longitude of the ascending node, also known as the right ascension of the ascending node, measures the angle between the spacecraft's current orbit's ascending node and a fixed point on the primary body. For Earth, the fixed point is created by drawing a line from the Earth's geocentre to the equatorial plane directly toward the Sun at the exact moment of the Northern Hemisphere vernal equinox. To find the longitude of the ascending node from here, measure the angle between this line and the point where the orbit crosses the equatorial plane northward.

### 2.6 Argument of Periapsis

Abbreviated to AOP and notated as *ω,* the argument of periapsis is a crucial angular coordinate that allows a navigator to calculate where the periapsis is oriented relative to the ascending node. Measured in degrees in the direction of the spacecraft's velocity, it is the angle from the ascending node to the periapsis, as displayed in Fig. 3.

<figure class="paper-figure">
  <div class="figure-placeholder">Figure</div>
  <figcaption><strong>Fig. 3</strong> Defining parameters of the argument of periapsis.</figcaption>
</figure>

If the orbit's geometry places the periapsis exactly at the ascending node, the argument of periapsis is 0. When the periapsis is situated at the orbit's most northern latitude, the AOP becomes 90˚, while a periapsis located directly at the descending node creates an AOP of 180˚.

### 2.7 True Anomaly

For an unperturbed Keplerian orbit, the true anomaly is the only orbital element that changes over time. Unlike the mean and eccentric anomalies—which are mathematical parameters used to simplify tracking orbital time—the true anomaly defines the exact, instantaneous physical position of a spacecraft along its trajectory. As noted by [John D. Cook](https://www.johndcook.com/blog/2022/10/22/orbital-anomalies/), the three anomalies are simply "all ways of describing where an object is in its orbit." The true anomaly measures the physical angle between the spacecraft's position, the primary body's center of mass (focus), and the periapsis direction. Because Kepler's second law dictates that a spacecraft continually changes speed along an elliptical path, this angle does not change linearly with time. To resolve this non-linear movement, engineers invoke the parameter of mean anomaly.

### 2.8 Mean Anomaly

Whilst a similar metric, true anomaly is not to be confused with mean anomaly. True anomaly measures a physical geometric angle, whereas mean anomaly cannot be measured directly and must be calculated. Because a satellite's velocity varies along an ellipse, its true anomaly changes non-uniformly. Mean anomaly solves this complication by translating time into a uniform angular parameter, calculating the time elapsed since periapsis as a fraction of the total orbital period, showing where the spacecraft would be if it traveled at a perfectly constant angular speed. Consequently, a spacecraft's true anomaly differs from its mean anomaly in any non-perfectly circular orbit. To convert between the two, orbital mechanics relies on a geometric stepping stone known as the eccentric anomaly.

### 2.9 Eccentric Anomaly

The eccentric anomaly serves as the mathematical bridge connecting the mean and true anomalies. It relies on the auxiliary circle, an imaginary perfect circle drawn with a radius equal to the orbit's semi-major axis, centered on the ellipse's midpoint and connecting the periapsis and apoapsis. To find the eccentric anomaly, one projects the spacecraft's true position vertically onto this auxiliary circle; the eccentric anomaly is the angle measured from the ellipse centre between the periapsis and this projected point. Unlike the true anomaly, which is measured from the primary focus, the eccentric anomaly is strictly centered on the geometric midpoint of the ellipse. All three anomalies share a value of 0˚ at periapsis and 180˚ at apoapsis. When the spacecraft's distance to the ellipse center matches the semi-major axis along the y-axis, the eccentric anomaly reaches exactly 90˚, scaling proportionally with the geometry of the orbital axes.

<figure class="paper-figure">
  <div class="figure-placeholder">Figure</div>
  <figcaption><strong>Fig. 4</strong> A visual representation of the orbital anomalies.</figcaption>
</figure>

## 3. Equations of Orbital Motion

Now that all the important parameters necessary to fully describe an orbit have been established, we can begin to cover the basic formulas used to determine them. The formulas covered in this chapter follow the laws of Keplerian mechanics, meaning they assume a two-body system without accounting for the orbiter's mass, because when dealing with a simple satellite in earth orbit, the satellite's mass is negligible. Furthermore, these equations do not account for external forces such as N-body gravitation, the residual atmospheric drag, or solar radiation. However, as this manual is only intended to give a pilot the knowledge needed to perform orbital mathematics for a few hours before getting back home, these factors can be overlooked, and the information given will be sufficient. The next page gives a table with descriptions of the formulas and the notation for them, followed by more detailed explanations of the most critical ones.

### 3.1 Table of Formulas

| Description of Formula | Mathematical Notation |
| :---- | :---- |
| Standard Gravitation Parameter | µ = GM |
| Velocity for circular orbit | vc = √(µ/r) |
| Velocity at a given point for eccentric orbit | v² = µ · (2/r − 1/a) |
| Eccentricity of an orbit | e = (rap − rpe)/(rap + rpe) |
| ∆v required for apoapsis/periapsis adjustment | Δv = \|vf − vi\| |
| ∆v required for inclination changes | ∆v = 2vi · sin(∆i/2) |
| ∆v for a Hohmann transfer | ∆v = \|∆v₁\| + \|∆v₂\| |
| Time of burn to reach ∆v with changing acceleration | tb = m₀ / ṁ · (1 − e^(−ṁ · Δv / F)) |
| Maximum burn time for a spacecraft | tb = ((m₀ − mf) · Isp · g₀) / F |
| Escape Velocity | ve = √(2µ/r) |
| Hyperbolic Injection Velocity | vinj = √(vesc² + v∞²) |
| ∆v required for escape velocity | ∆v = vinj − vMN |
| Excess Hyperbolic Velocity | v∞ = \|vmoon − vap\| |
| Orbital Period | P = 2π · √(a³/µ) |
| Eccentric Anomaly | E = 2 arctan(√((1−e)/(1+e)) · tan(f/2)) |
| Mean Anomaly | M = E − e · sin(E) |
| Gravitational Acceleration | a = µ/r² |

### 3.2 Standard Gravitational Parameter

When making calculations in orbital mechanics, there is one other parameter that is just as important as the orbital characteristics; the standard gravitational parameter, written as GM and µ interchangeably. It is defined by the primary body's mass times Newton's gravitational constant G, valued as 6.67×10⁻¹¹. This is a constant value that applies anywhere within a body's sphere of influence (SOI), and along with the mass of Earth, 5.972×10²⁴, the µ value in Earth orbit is always 3.986×10¹⁴ m³/s² (For the Moon, it is 4.9×10¹², and for the Sun it is 1.3267×10²⁰). This quantity is necessary to remember, it appears in almost every equation of orbital mechanics.

### 3.3 Circular Orbit Velocity

The formula for a vehicle in a circular orbit, that being one with an eccentricity of 0, is an incredibly simple equation. It is simply the square root of the primary body's µ value divided by the orbital radius, or in mathematical terms, it is written as vc = √(µ/r). Note that the orbital radius, or the altitude of an orbiting craft, is measured from the body's centre, so to make an accurate calculation, a pilot must have knowledge of the planetary body's radius, then add that to the altitude value his instruments are showing. (This document will use the term altitude for the orbital radius, but it still refers to the distance from the geocentre). For example, the radius of Earth is approximately 6.378×10⁶ metres, so any mathematical equations done by an astronaut in Earth orbit must have that value added to the altitude shown e.g. calculations for a vehicle in a circular Low Earth Orbit (LEO) of 300km will be expressed as 6.678×10⁶. Below, a written example, a satellite in circular parking orbit of 237 km:

```
vc² = µ / r
⇒ v = √(3.896×10¹⁴ / 6.651×10⁶)
    = √59930837.5
v   = 7,741.5 m/s
```

Using this formula, we can find the velocity of the satellite in this circular orbit of 237 kilometres to be 7741.5 metres per second.

### 3.4 Specific Orbit Velocity

Whilst the √(µ/r) formula works great for circular orbits, it falls apart when the orbit has an eccentricity greater than 0. For scenarios like this, the formula becomes slightly more complicated; whilst still invoking the µ and r quantities, we now have to introduce the element that distinguishes an eccentric orbit from a circular one, that being the semi-major axis *a*. After deriving from the total orbital energy, we arrive at the vis-viva equation, for orbital velocity when 0 < *e* < 1, written as the following formula:

```
v² = µ · (2/r − 1/a)   or   v² = GM · (2/r − 1/a)
```

The square of the velocity is equal to the fractions, 2 over the current radius minus 1 over the SMA, then multiplied by the standard gravitational parameter of the primary body.

Written example: A spacecraft has an apogee of 500 km, a perigee of 300 km, the current altitude is 482.1 km. Find the spacecraft's current velocity.

```
v² = GM · (2/r − 1/a)
r  = 6.378×10⁶ + 482100 = 6.8601×10⁶
⇒ v = √(µ · (2/(6.8601×10⁶) − 1/(6.778×10⁶)))
    = √(3.986×10¹⁴ · 1.440047×10⁻⁷)
    = √57443474.83
v   = 7,579.15 m/s
```

Using these equations, we can conclude an orbiting spacecraft with an apogee of 500 km, a perigee of 300 km, and an altitude of 482.1 km will have a velocity of 7579.15 m/s. This formula is useful for calculating orbital velocity at any point in the orbit.

### 3.5 Eccentricity

The eccentricity of an orbit's ellipse is remarkably easy to calculate, it is found by dividing the difference of the major and minor axes by their sum, notated as e = (rap − rpe)/(rap + rpe). Eccentricity is crucial for calculating the position of an object over time, as well as solving Kepler's equations when finding orbital anomalies. In mission design, this crucial parameter enables scientists and engineers to determine a spacecraft's altitude variations over time, predicting eclipse times, and calculating precise engine burns.

### 3.6 Anomalies

In order to calculate the mean, true, and eccentric anomalies, one must first know the others, and as such they aren't very useful for an astronaut navigating astrodynamics, nor are they very practical. The mean anomaly formula requires one to already know the eccentricity and the eccentric anomaly, given by M = E − *e* · sin(E). Rather than calculating the mean anomaly this way, a more commonly used method is simply to log every pass of periapsis and apoapsis, calculate the orbital period, and find the percentage of the orbit from the time elapsed since periapsis or apoapsis. To find the true and eccentric anomalies, rather than calculating them by hand, an astronaut with a failed guidance computer but functional telemetry should contact ground tracking stations for their observations, which can help determine these parameters much more accurately.

## 4. Orbital Manoeuvring

While the basic principle of orbit is fairly straightforward, the ideas of orbital manoeuvring, that is, making adjustments to a spacecraft's orbit, are unintuitive. This chapter will focus on the basic mechanics of orbital manoeuvring, explain the complicated dynamics, and give guidelines for manual controlling spacecraft.

### 4.1 Addendum

Before we can begin to consider transitioning from the basic elements of orbital mechanics to real-world applications involving spacecraft and orbital manoeuvres, it is necessary to introduce a few fundamental concepts of rocketry.

#### 4.1.1 Specific Impulse

Specific Impulse is a measure of how efficiently a rocket engine can convert the chemical energy of the propellant into workable kinetic thrust. Based on fundamental physics principles, this metric is directly proportional to the velocity at which the hot gases are expelled from the engine nozzle. Because the propellant used to power an engine has mass, as dictated by Newton's Third Law, the faster an engine can expel mass, the less propellant is required to produce an equivalent force in the opposite direction. "The engine with the higher value of specific impulse is more efficient because it produces more thrust for the same amount of propellant" (NASA 2015). Expressed in seconds, it quantifies the duration for which an engine can produce a unit of thrust force relative to the Earth-surface weight flow rate of the consumed propellant. Mathematically, this means the specific impulse is found by dividing the thrust by the propellant consumption rate after it's multiplied by Earth's gravitational acceleration, 9.81. Isp is one of the foundational parameters for determining the Delta-V and payload capacity of a spacecraft, making it a critical factor for the feasibility of any rocket engine.

#### 4.1.2 Delta-V and the Tsiolkovsky Equation

Delta-V is a quantity of a spacecraft's range, using the craft's initial and final mass and specific impulse to determine how much a spacecraft can change velocity in space. "Think of it like the range of a car which factors in the engine efficiency, fuel tank size and how much the car needs to push around" (Dodd 2020). These factors allow engineers to find the total Delta-V of a spacecraft from the Tsiolkovsky rocket equation, written as ∆v = Isp · g₀ · ln(m₀/mf). This equation is used to find the maximum amount by which a vehicle can change its velocity, ignoring factors such as air resistance and Earth's gravity, taking into account the rocket's mass when fully fueled and empty, and the engine's exhaust velocity, found by multiplying the specific impulse and g₀. The term g₀ is a constant, with a fixed value regardless of the gravity of the current primary. It's used as a mathematical conversion, as specific impulse can be defined by the exhaust velocity divided by the gravity of the primary body. This also means that the Tsiolkovsky equation can be written as ∆v = ve · ln(m₀/mf). This equation reveals the harsh reality that engineers call the tyranny of the rocket equation; the fuel required to launch a payload into orbit is orders of magnitude greater than the mass of the payload itself, resulting in the mass of modern launch vehicles being over 85% fuel. Furthermore, there are greatly diminishing returns in Delta-V from increasing propellant mass. "If you were to double the amount of fuel in your rocket, you wouldn't double the Delta V, due to now having to push around all the extra weight of the extra fuel and the fuel tank that holds it" (Dodd 2018).

#### 4.1.3 Rocket Propellants and Engine Cycles

A rocket, at its fundamental physics core, is a machine that expels mass at the highest possible velocity in one direction to produce a reaction in the opposite direction, propelling it forwards. The simplest and easiest approach to this is to store a gas (usually nitrogen or helium) in a tank at extremely high pressure (usually over 300 Bar), opening a valve and letting the gas flow quickly due to the extreme pressure difference. This is known as a cold gas thruster, the simplest rocket engine with only one moving part, a simple valve, making them reliable, simple, and easy to use. However, as the name implies, due to the lack of combustion in the system, the engine runs cold. This makes the engine efficiency low, with most cold gas thrusters topping out at 70 seconds of specific impulse, which is 3-4 times lower than even the most basic pump-fed engine. Furthermore, in order to improve the efficiency of a cold gas thruster, the gas must be stored at higher pressure, which requires the propellant tanks to have thicker and heavier walls. Eventually, this extra dead weight cancels out any gains in the system's overall Delta-V. To bypass this limitation, engineers will often use a significantly more efficient but still highly simple and reliable engine type, known as a monopropellant engine. Like cold gas thrusters, monopropellant (or monoprop) engines rely simply on pressurised tanks to ensure flow of fuel, and as the name implies, they also use a single propellant. Monopropellant engines can achieve much higher efficiency than cold gas thrusters due to them harnessing the chemical energy of the propellant. Instead of storing the propellant at high pressures over 300 Bar, in monopropellant engines, it is stored at a much lower but still very high level, mostly between 20-40 Bar. Similar to cold gas thrusters, monoprop engines only rely on valves, however monoprops utilise a pressure regulator, connected to a tank full of an inert gas (usually helium) called the pressurant gas, that fills the propellant tank with the inert gas in as the primary fuel drains, ensuring stable pressure as the engine burns. As previously mentioned, exothermic decomposition occurs in monopropellant engines, done by running the primary fuel over a catalyst bed, which converts the chemical energy of the propellant into heat and pressure, which is then expelled from the engine nozzle as hot gas. Fig. 5 shows this chemical process.

<figure class="paper-figure">
  <div class="figure-placeholder">Figure</div>
  <figcaption><strong>Fig. 5</strong> Monopropellant engine schematic.</figcaption>
</figure>

The efficiency of an engine is partly determined by the choice of propellant. Hydrazine and hydrogen peroxide are two of the most common monopropellants, being run over iridium-infused alumina and potassium permanganate respectively. Hydrazine can offer up to 30% higher specific impulse than high-concentration H2O2, however its extreme toxicity leaves engineers with a trade-off between efficiency and safety. Engines like these are called pressure fed engines, and due to their ability to light quickly, reliably, and safely, they are commonly used in RCS systems such as on the Mercury and the Soyuz capsule. However, there is an engine type that can offer significantly higher efficiency while still being fairly simple. Like monoprop and cold gas thrusters, they rely only on pressure and valves, but the key difference of bipropellant engines is that they use both a fuel and an oxidiser to achieve combustion in the engine.

<figure class="paper-figure">
  <div class="figure-placeholder">Figure</div>
  <figcaption><strong>Fig. 6</strong> Bipropellant pressure-fed engine schematic.</figcaption>
</figure>

The combustion occurring in bipropellant engines means they are usually over 300 seconds of specific impulse, significantly more than the 150-250 seconds range of monoprops, making them an ideal choice for OMS motors, however they are also common for reaction control systems. To further improve efficiency and reliability, biprop engines will often use hypergolic propellants, which are used because they are "simple and reliable since they don't require any ignition" (StarSync 2026). These liquids ignite on contact with each other, meaning there is no need for a secondary ignition source like a spark plug or flame, however they are incredibly toxic and carcinogenic. Dinitrogen tetroxide and hydrazine are common hypergolic fuels, with notable examples including the Apollo CSM main engine, the Dragon spacecraft's manoeuvring thrusters, as well as the Space Shuttle's OMS motors. These three types of engines are commonly used for in-space operations, as they only rely on pressure and simple valves, making them highly reliable. simple and reliable since they don't required any ignition.

#### 4.1.4 Orbital Reference Frame

When orbiting a planet or moon, it is vital for a spacecraft to be able to tell its orientation in space. The spacecraft's Attitude Determination and Control Systems (ADCS) convert tracking and positioning data into intuitive visual information displayed on a pilot's primary instrument unit: the navball, which interprets these orientations within the Orbital Reference Frame, a coordinate system that describes the vehicle's attitude relative to the local flight path with six main vectors. These are called prograde, retrograde, normal, anti-normal, zenith, and nadir, and they provide a universal coordinate system for spacecraft in orbit. Prograde aligns with the spacecraft's direction of travel, whereas retrograde is the exact opposite attitude. Normal and anti-normal point perpendicular to the flight path vector, and zenith and nadir (also known as radial out and radial in) track parallel to the orbital radius, facing directly away from and towards the planet respectively. Acceleration along these vectors will predictably manipulate orbital characteristics. In an instantaneous radial burn, the semi-major axis and orbital period will remain constant, but the orbit will "take a more exaggerated elliptical path" (Cook 2025), increasing eccentricity instead. A zenith burn will affect the eccentricity and AOP, placing the periapsis closer to the burn position while raising the apoapsis; whereas a nadir impulse rotates the orbit in the opposite direction. Any radial or inclined impulse from a circular orbit will not result in position change 180 degrees away from the manoeuvre node. Used most often, the tangential prograde and retrograde burns are done inline with the motion vector, forcing the altitude 180 degrees away to raise or lower respectively. To modify one's orbit, the ability to manually manage these attitude adjustments is crucial. This can be done with back-up controls isolated from a guidance computer failure. Similar to an aircraft's instrumentation, these attitude vectors will show on an astronaut's navball and, along with the fixed coordinate indicators (FCI), show the flight path relative to fixed coordinates. The table on the next page shows the symbols for each attitude vector, which can be aligned with the True Attitude Indicator (TAI) to assume the desired attitude. The fixed coordinate markings measure degrees on a navball to give a pilot the necessary indications to maintain a desired attitude, and as per standard in the aerospace industry, coordinates are expressed in the (Z-X-Y) or Yaw-Pitch-Roll sequence. A spacecraft aligned with its direction of travel in an equatorial orbit with its underside parallel to the planet's surface will have its prograde marker at the coordinates (0,0,0). In the same orbit, its zenith marker will be (0, 90, 0), the normal marker will be (90, 0, 0), and the retrograde coordinates can be expressed as either (180, 0, 0) or (0, 180, 0). As the orbital reference frame constantly rotates relative to the primary body, an orbiting spacecraft left entirely uncontrolled will maintain absolute orientation, causing it to drift away from relative orientation, at the same rate as it changes true anomaly.

### 4.2 Apsis Manoeuvres

The most common type of orbital manoeuvring is apoapsis and periapsis adjustments, which involve changing velocity at one to raise or lower the other. This can be done for many reasons; circularising at apogee, the first phase of a Hohmann transfer, and many more applications. "A spacecraft's apoapsis radius is raised by increasing the spacecraft's velocity at periapsis" (NASA 2024) and vice versa. The opposite is true for lowering the apses, meaning that to decrease the periapsis, you would need to decelerate at apoapsis. To find the required change in velocity to achieve the desired change in altitude<sup>1</sup>, an astronaut must calculate the trajectory's current velocity at the manoeuvre node (MN), then determine the orbit's velocity at the MN after the burn. They must then find the difference between the initial velocity (*vi*) and the final velocity (*vf*), and that value will equal the amount that they must accelerate at the MN.

Worked example; a crewed spacecraft in circular parking orbit 140 km must raise their apogee to 400 km to prepare for a Hohmann transfer to reach the ISS:

```
vc  = √(µ / r)
v   = √((3.986×10¹⁴)/(6.518×10⁶))
v   = 7,820.1 m/s
vpe = √(µ · (2/r − 1/a))
a   = ((6.518×10⁶)+(6.778×10⁶))/2 = 6.648×10⁶
vpe = √((3.986×10¹⁴) · ((2/6.518×10⁶) − (1/6.648×10⁶)))
vpe = 7896.2 m/s
∆v  = vf − vi = 7896.2 − 7820.1
∆v  = 76.1 m/s
```

To calculate the Delta-V required for circularisation burns, one needs to find the velocity in the desired circular orbit, then subtract or add their current orbit's velocity at apoapsis or periapsis depending on the point at which they are circularising to find the amount by which they need to accelerate or decelerate. As an example, imagine the same spacecraft used in the first example circularising at apogee into a 400 km to complete the Hohmann transfer:

```
vc  = √(µ/r)
    = √((3.986×10¹⁴)/(6.778×10⁶))
vc  = 7,668.6 m/s
vap = √(µ · (2/r − 1/a))
    = √((3.986×10¹⁴) · ((2/6.778×10⁶) − (1/6.648×10⁶)))
vap = 7593.2 m/s
∆v  = vc − vap = 7,668.6 − 7593.2
∆v  = 75.4 m/s
```

Using these equations, we can confidently predict that to circularise into a 400 kilometre orbit from a 140x400 kilometer orbit, a pilot must accelerate their vehicle by 75.4 metres per second, and to complete the entire Hohmann transfer, these values are added together to find the total change in velocity required to transition between two circular orbits of 140 km and 400 km, which in this example yields a ∆v of 151.5 m/s.

### 4.3 Inclination Changes

Inclination changes are costly manoeuvres that involve burning perpendicular to the orbital plane (called the normal and anti-normal attitudes) in order to alter the tilt of the orbit. "To change the orientation of the orbital plane in space requires a ∆v component perpendicular to the plane of the orbit" (Bate, Mueller & White 1971). These manoeuvres are highly propellant-intensive due to the fact that they require the spacecraft to redirect its entire velocity vector, which in orbital mechanics is quite literally an astronomical force. The ∆v required for a plane change is defined by the formula:

```
∆v = 2vi · sin(∆i/2)
```

The normal vector for a vehicle orbiting eastward in a 0 degree inclination will be due north, and the anti-normal vector will be due south. Burning normal at the ascending node will increase the inclination of an orbit, whereas normal impulses at the descending node will decrease the value, and anti-normal forces at those respective points will have the opposite effect. It should be noted that when a vehicle is already in high inclination orbit, burning further away from the ascending or descending node will be less effective at adjusting the orbital plane, and will instead have more impact on the longitude of the ascending node. This effect continues to the point where a spacecraft in a polar orbit will not be able to change its inclination 90 degrees away from the ascending node. At this point, the spacecraft will be over the North or South Pole, and burning normal or anti-normal will only affect the longitude of the ascending node.

### 4.4 Transfer Orbit Injections

Knowledge of escape velocity is essential for transfer orbit injections, which place a spacecraft on a trajectory to leave one body's sphere of influence and enter another's. Whilst interplanetary or cislunar navigation may seem intimidating, calculating these manoeuvres is only slightly more difficult than standard apoapsis/periapsis manoeuvres. The only thing that changes is that once a spacecraft has achieved the escape velocity for a planet or moon, the secondary body no longer dominates the gravitational fields, and equations transition to be measured with the target's parameters. When efficiently performing a transfer orbit injection from a moon<sup>2</sup> with the primary body as the target, also known as a Trans-Primary Injection, the manoeuvre must be executed when the spacecraft's prograde vector for the secondary body aligns with its retrograde vector relative to the target. In other words, when the prograde vector in lunar orbit is against the moon's orbital motion. This way, as the spacecraft accelerates to leave the moon's orbit, it will decelerate relative to Earth, saving a portion of the Delta-V required to slow down enough for atmospheric intercept. A standard Trans Earth Injection involves a single burn during which a spacecraft transitions directly from a circular lunar orbit through an eccentric, a parabolic, and finally a hyperbolic escape trajectory, seen in Fig. 7.

<figure class="paper-figure">
  <div class="figure-placeholder">Figure</div>
  <figcaption><strong>Fig. 7.</strong> The orbits a spacecraft transitions between during a Trans Earth Injection manoeuvre.</figcaption>
</figure>

After the spacecraft has reached the hyperbolic orbit, it has effectively left the moon's gravitational influence and is being measured with Earth as the primary body, despite being more or less in the same position. To calculate the Delta-V needed for a Trans Primary Injection, or TPI, one defines a target periapsis (usually 30 - 40 kilometres for Earth). Whilst still in orbit of the secondary body, using the vis-viva equation v² = µ·(2/r − 1/a), the astronaut must calculate their spacecraft's velocity at the manoeuvre node relative to the primary body, with the target periapsis in mind. (Note that once escape velocity is reached, the manoeuvre node's altitude from the primary body will be approximately the spacecraft's apoapsis from the primary). After the velocity at apoapsis for an atmospheric intercept trajectory has been found, the astronaut must then find the escape velocity at the altitude of the manoeuvre node, given by the formula vesc = √(2µmoon/rnode). However, the moon's orbital velocity must be taken into account, and the parameter of hyperbolic excess velocity must be introduced. This is the velocity the spacecraft must retain after it has completely escaped the moon's gravity. Because a TPI burns retrograde relative to the target primary, this excess velocity, given by the formula v∞ = |vmoon − vap|, bridges the gap between the moon's orbital velocity and the required return speed. As kinetic energy scales with the square of velocity, the final injection velocity (vinj) combines these values in a Pythagorean relationship: vinj = √(vesc² + v∞²). The final step in calculating a TPI manoeuvre is to determine the Delta-V needed to reach injection velocity from the circular velocity in the parking orbit shown in Fig. 7, simply written as ∆v = vinj − vMN. After this manoeuvre has been performed, several slight course corrections may be needed during the coast phase back to Earth, but these are fairly easy to calculate and perform with the addendum equations already covered.

### 4.5 Hohmann Transfers

The first type of a Hohmann transfer is the most efficient, fastest method of transitioning between two circular, coplanar orbits. They involve two impulses; one to raise or lower the opposing apsis, then coasting along the new eccentric orbital trajectory, then circularising half an orbit later. In a Hohmann transfer, the change in velocity required to move between two orbits remains the same, regardless of whether the spacecraft is travelling from a lower orbit to a higher one or vice versa. Hohmann transfers follow one of two specific processes, depending on whether the spacecraft moves to a higher or lower orbit.

<figure class="paper-figure">
  <div class="figure-placeholder">Figure</div>
  <figcaption><strong>Fig. 8</strong> The two types of Hohmann transfers.</figcaption>
</figure>

The examples shown in Fig. 8 follow the same trajectory and orbits, their only difference is the order in which they move between them. The right scenario in Fig. 5 assumes a spacecraft transitioning from a high to a low orbit. From its initial high orbit, the spacecraft decelerates at Maneuver Node 1 (MN 1) and the periapsis is lowered. The spacecraft then enters the transit orbit, known as the coast phase, until it reaches Manoeuvre Node 2 (MN 2), where it slows down once again to enter the final circular low orbit. In the second scenario, the spacecraft's initial orbit is the same as the first's final low orbit. Instead of decelerating at MN 1, it accelerates, raising the periapsis, before circularising at apoapsis. As previously explained, these two spacecraft will have used the same amount of Delta-V to travel between their respective orbits. Since the two impulses are made in the same orbit, the time between them will be half of the orbital period of the elliptical transit orbit, found by the adjusted orbital period formula P = π·√(a³/µ).

### 4.6 Executions

Having established all the equations necessary to determine the change in velocity required, we can now introduce the process of executing these manoeuvres. To alter orbital altitudes, a spacecraft must accelerate in or against the direction of travel at the opposite apsis to the target altitude. This point in the orbit will be the manoeuvre node. Standard protocol for manoeuvre execution dictates that the burn should initiate prior to the node by the interval equivalent to half of the calculated total burn duration. Calculating burn times cannot be done with standard kinematic equations such as t=∆v/a, as a rocket's mass, and by extension acceleration, will continuously change every second the engines are running, due to the fact that the engines will be depleting propellant mass. To get around this issue, we must find the total change in velocity over the unknown timeframe, integrate the acceleration, and evaluate the integral to arrive at the following formula:

```
tb = m₀ / ṁ · (1 − e^(−(ṁ · Δv / F)))
```

This formula assumes that the spacecraft's initial mass, rate of propellant consumption, and thrust of the primary propulsion system are all known, and it solves for the burn time required to change velocity by a known quantity, expressed as ∆v. (Note that in this formula, e refers to Euler's number, not the orbit's eccentricity). A pilot should have studied and should know all these specifications of their spacecraft, and the mass at any time will be displayed on their instrumentation panels. Worked example below:

```
A spacecraft needs to perform an apogee raise manoeuvre requiring 168 m/s ∆v.
Its OMS engine produces 20,000 N, its initial mass is 4070 kg, and burns 8.15 kg/s.

tb = (4070 / 8.15) · (1 − e^(−(8.15·168/20,000)))
   = 499.4 · (1 − e^(−0.06846))
   = 499.4 × 0.0662
tb = 33.0603 seconds
```

Kepler's time equation can be used to find the time to apogee, but it is simply easier to calculate the orbital period, halve it, subtract half the burn time, then count down to that after passing periapsis and apoapsis to know when to start the burn. Once the burn time has been determined, a pilot should disengage the RCS to keep the mass the same and the calculations accurate. Re-engage RCS before the manoeuvre node at a time equal to one burn-duration before.

## Appendix A: Emergency Scenarios

### Scenario A1: GNC Failure in Circular Parking Orbit

Situation: LEO parking orbit, guidance computer dead, telemetry & OMS operational
Objective: Deorbit and return safely

**Procedure:**

1. Determine current orbital period
2. Calculate velocity
3. Determine the required periapsis for atmospheric entry
4. Calculate retrograde Delta-V
5. Calculate burn duration
6. Determine target landing zone and calculate manoeuvre node position
7. Initiate burn half a burn-duration before the node
8. Verify periapsis after burn
9. Prepare for re-entry

### Scenario A2: GNC Failure during Orbital Insertion

Situation: Suborbital trajectory, guidance computer dead, telemetry & OMS operational
Objective: Circularise manually

**Procedure:**

1. Determine projected apoapsis from telemetry
2. Calculate circular velocity at apoapsis
3. Calculate current velocity at apoapsis
4. Calculate prograde ∆v
5. Calculate burn duration
6. Initiate burn half a burn-duration before apoapsis
7. Verify orbit
8. Begin re-entry procedure (See A1)

## Appendix B: Reference Checklists

### B1. Apsis Raise Checklist

- [ ] Determine current apsis altitude
- [ ] Determine target apsis altitude
- [ ] Calculate velocity after node
- [ ] Calculate velocity at node
- [ ] Subtract to find ∆v
- [ ] Calculate burn duration
- [ ] Disengage RCS and wait
- [ ] Engage RCS one burn-time before node
- [ ] Assume prograde attitude
- [ ] Start burn half burn-time before node
- [ ] Verify orbit

### B2. Circularisation Checklist

- [ ] Determine node altitude
- [ ] Calculate velocity in circular orbit
- [ ] Calculate current velocity at node
- [ ] Calculate velocity after manoeuvre node
- [ ] Calculate ∆v
- [ ] Calculate burn duration
- [ ] Disengage RCS
- [ ] Engage RCS one burn-time before node
- [ ] Point in manoeuvre node vector
- [ ] Start burn half burn-time before node
- [ ] Verify orbit

### B2. Apsis Lower Checklist

- [ ] Determine current apsis altitude
- [ ] Determine target apsis altitude
- [ ] Calculate velocity at node
- [ ] Calculate velocity after node
- [ ] Subtract to find ∆v
- [ ] Calculate burn duration
- [ ] Disengage RCS
- [ ] Engage RCS one burn-time before node
- [ ] Assume retrograde attitude
- [ ] Start burn half burn-time before node
- [ ] Verify orbit

### B4. Plane Change Manoeuvres

- [ ] Determine current inclination
- [ ] Determine target inclination
- [ ] Calculate ∆i
- [ ] Disengage RCS
- [ ] Wait for AN or DN
- [ ] Engage RCS one burn-time before node
- [ ] Assume normal/anti-normal attitude
- [ ] Start burn half burn-time before node
- [ ] Verify inclination

## Appendix C: Quick Reference Formula Sheet

**Crucial Formulas**

```
Circular Orbit velocity   vc = √(µ/r)
Vis-Viva Equation         v  = √(µ·(2/r − 1/a))
Plane Change Delta-V      ∆v = 2vi · sin(∆i/2)
Rocket Equation           ∆v = Isp · g₀ · ln(m₀/mf)
Escape Velocity           vesc = √(2µ/r)
Orbital Period            P = 2π · √(a³/µ)
```

**Common Mission Values**

```
Circularisation from suborbital trajectory:   ~100-250 m/s
LEO → GEO transfer:                           ~3.9 km/s ∆v
Trans Lunar Injection:                        ~3.1 km/s ∆v
Lunar Orbit Insertion:                        ~0.9 km/s ∆v
Trans-Earth Injection:                        ~1.1 km/s ∆v
Earth Escape Velocity:                        ~11 km/s
Lunar Escape Velocity:                        ~2.35 km/s
Typical Entry Interface:                      ~120 km
```

These values are useful for sanity-checking one's arithmetic.

## Appendix D: Constants

**Earth Constants:**

```
µ:                            3.986×10¹⁴ m³·s⁻²
Sidereal Day:                 86,164 s
Radius:                       6.378×10⁶ m
g₀:                           9.81 m/s²
SOI Radius:                   ~924,000 km
Orbital velocity around primary: ~29.78 km/s
a:                            1.496×10¹¹ m
```

**Lunar Constants:**

```
µ:                            4.91×10¹² m³·s⁻²
Mass:                         7.347×10²² kg
Radius:                       1.737×10⁶ m
Surface Gravity:              1.62 m/s²
SOI Radius:                   ~66,000 km
Orbital velocity around primary: ~1.02 km/s
a:                            3.844×10⁸ m
```

**Solar Constants:**

```
µ:    1.327×10²⁰ m³·s⁻²
M:    1.989×10³⁰ kg
AU:   1.496×10¹¹ m
```

## Appendix E: Practice Problems

**Part 1: Multiple Choice**

1. When a spacecraft's nose is pointing in the direction of travel, its attitude is *prograde* / *normal* / *radial*
2. An orbit's *apoapsis* / *inclination* / *AOP* will increase when acceleration occurs at periapsis
3. It is more efficient to make plane changes when at *high perigee* / *apogee* / *true anomaly of 90*
4. Burning normal/anti-normal at high/low latitudes changes *inclination* / *eccentricity* / *LAN*
5. AOP is *0* / *180* / *100* when the periapsis is at the descending node.
6. While in orbit, a pilot should maintain a *normal* / *retrograde* / *radial* attitude
7. *Eccentric* / *True* / *Mean* Anomaly is 0 when the spacecraft's altitude matches the SMA
8. Launching due east from the equator will put a vehicle in a *90* / *0* / *180*
9. The argument of periapsis defines the orbit's *plane angle* / *orientation of the ellipse* / *major axis.*
10. To increase the apoapsis, the pilot should burn in the prograde zenith
11. *Minor* / *Major* / *Semi-Major* Axis describes the average of the apoapsis and periapsis
12. When orbiting on the daytime side of a body, a pilot should keep and use the *Earth* / *Stars* / *Sun* as a reference point in the window
13. When performing the calculations of orbital mechanics, altitude is measured as the spacecraft's distance above *sea level* / *ground level* / *the body's geocentre*.
14. A radial burn will increase *eccentricity* / *apoapsis* / *inclination*
15. The formula for inclination changes invokes *sine* / *cosine* / *tangent*

**Part 2: Write your answer**

1. What is the formula for calculating orbital velocity in a circular orbit?

   *v² = µ/r*

2. If you wish to raise your altitude at 000˚ *f*, what point should you change velocity?

   *Accelerate at 180˚ f.*
   When *ω* = 90, *i* = 90, what will burning at 090 or 180 *f* affect?
   *Longitude of Ascending Node only*

3. In the scenario of the automation computer failing whilst on a suborbital trajectory to a parking orbit, what should a pilot do to perform a manual circularisation burn? Include formulas.

   *Answer: calculate the velocity of the spacecraft in the circular orbit (v=√µ/rap) and the velocity at apogee for the current trajectory (v=√µ·2/rap − 1/a), then find the difference between the two (∆v = vf − vi). Next, note the craft's current mass, and with the thrust of the engine and the propellant consumption rate, calculate the time required for the craft to achieve the necessary Delta-V (tb = m₀ / ṁ · (1 − e^(−ṁ · Δv / F))). Ignite the OMS engine when the time to apogee is half of the required burn time, and keep burning until the velocity matches the value for a circular orbit of that altitude.*

4. The guidance computer fails whilst in a parking orbit 108.6 by 104.2 kilometres, and the mission objective is to perform a burn to reach geostationary transfer orbit in 40 minutes, before circularising into geostationary orbit at apogee. What should a pilot do to achieve the objectives?

   *Depending on whether the vehicle is ascending or descending, calculate the delta-v required to raise the apogee or perigee to a more stable orbit. Then, circularise at the new apogee, before contacting Mission Control for further instructions.*

## Acronym Glossary

- **ADCS** — *Attitude Determination and Control System:* The hardware and software systems responsible for managing a spacecraft's orientation in space.
- **AOP** — *Argument of Periapsis:* Parameter establishing the orientation of an orbit's ellipse.
- **FCI** — *Fixed Coordinate Indicators:* Degree markings on a navball to help align to attitude.
- **GEO** — *Geostationary Earth Orbit:* An orbit in which the satellite remains above the same point of Earth by orbiting once per day.
- **GNC** — *Guidance, Navigation, Control:* The system of hardware, sensors, and algorithms that calculates a spacecraft's position and maintains its orientation.
- **GTO** — *Geostationary Transfer Orbit:* An elliptical intermediate orbit used to deliver satellites to a high apoapsis before circularizing into Geostationary Earth Orbit.
- **HIV** — *Hyperbolic Injection Velocity:* The excess velocity above escape velocity given to a spacecraft at the start of an interplanetary or TPI trajectory.
- **Isp** — *Specific Impulse:* A measurement of a rocket engine's efficiency, expressed in seconds.
- **LAN** — *Longitude of the Ascending Node:* A fundamental orbital element measuring the angle from a reference direction to the orbit's ascending node.
- **LEO** — *Low Earth Orbit:* An orbit relatively close to Earth, under 2,000 km.
- **LOI** — *Lunar Orbit Insertion:* A propulsive manoeuvre involving a spacecraft decelerating to enter a stable lunar orbit.
- **OMS** — *Orbital Manoeuvring System:* Engine(s) primarily used for making orbital adjustments.
- **RPOD** — *Rendezvous, Proximity Operations, Docking:* The series of complicated orbital manoeuvres involved with bringing two craft together in space and mechanically linking them.
- **SMA** — *Semi-Major Axis:* The average orbital radius of an elliptical orbit.
- **SOI** — *Sphere of Influence:* approximate spherical region around a celestial body where its gravity dominates the motion of smaller objects or spacecraft.
- **TAI** — *True Attitude Indicator:* A marker permanently fixed over a navball to help a pilot accurately determine the nose direction of the spacecraft.
- **TCM** — *Trajectory Correction Manoeuvre:* A small engine burn performed during transit between bodies to fine-tune the spacecraft's flight path and correct navigational drift.
- **TEI** — *Trans Earth Injection:* A manoeuvre to propel a spacecraft out of lunar or planetary orbit and place it on a return trajectory towards Earth.
- **TLI** — *Trans-Lunar Injection:* A major manoeuvre used to propel a spacecraft out of Earth's gravity and on a trajectory bound for the Moon.
- **TPI** — *Trans Primary Injection:* A propulsive burn that accelerates a spacecraft out of a moon's orbit and onto a trajectory toward its primary parent body.

## References

Bate, R, Mueller, D & White, J 1971, *Fundamentals of Astrodynamics*, Cvut.cz.

Braeunig, R 2011, *Basics of Space Flight: Orbital Mechanics*, Braeunig.us.

Cook, J 2022, *Mean anomaly, true anomaly, and eccentric anomaly*, www.johndcook.com.

Cook, J 2025, *Page01, Basic trajectory burns*, Uaf.edu.

Dodd, T 2020, *Artemis VS Apollo – Will Artemis Actually Be Sustainable?*, Everyday Astronaut.

Dodd, T 2018, *Why Single Stage to Orbit rockets SUCK. The wacky history and future maybes of SSTOs*, YouTube, viewed 14 August 2025, <https://www.youtube.com/watch?v=Sfc2Jg1gkKA>.

NASA 2024, *Trajectories - NASA Science*, science.nasa.gov.

Klemen, J 2015, *CANADIAN SPACE LAUNCH: EXPLOITING NORTHERN LATITUDES FOR EFFICIENT SPACE LAUNCH A Research Report Submitted to the Faculty In Partial Fulfillment of the Graduation Requirements for the Degree of MASTER OF OPERATIONAL ARTS AND SCIENCES*.

Grey, J 2001, *Spaceflight | Types of Spacecraft, Trajectories, & Navigation*, Encyclopedia Britannica, viewed 31 May 2026, <https://www.britannica.com/science/spaceflight#ref741469>.

NASA 2015, *Specific Impulse*, Nasa.gov, NASA.

StarSync 2026, *Rocket Engine Cycles & Propulsion Fundamentals*, Medium, <https://medium.com/@sedsjapura/rocket-engine-cycles-propulsion-fundamentals-557ee0f9f5bff>.

## Bibliography

orbital-mechanics.space. (n.d.). *Orbital Nomenclature — Orbital Mechanics & Astrodynamics*. [online] Available at: <https://orbital-mechanics.space/the-orbit-equation/orbital-nomenclature.html>.

John (2022). *Mean anomaly, True anomaly, and Eccentric Anomaly*. [online] www.johndcook.com. Available at: <https://www.johndcook.com/blog/2022/10/22/orbital-anomalies/>.

Aldrin, E. (1963). *Line-Of-Sight Guidance Techniques For Manned Orbital Rendezvous*. PhD Thesis. pp.300–350.

European Space Agency (2020). *Types of orbits*. [online] ESA. Available at: <https://www.esa.int/Enabling_Support/Space_Transportation/Types_of_orbits>.

*Gravity & Mechanics - NASA Science* n.d., science.nasa.gov.

Braeunig, R 2011, *Basics of Space Flight: Orbital Mechanics*, Braeunig.us.

Manley, S 2014, *Orbital Mechanics On Paper - Part 1 - Addendum*, YouTube, viewed 31 May 2026, <https://www.youtube.com/watch?v=000zDI2nmq8>.

<https://www.skyatnightmagazine.com/space-science/orbital-eccentricity>

Grey, J 2001, *Spaceflight | Types of Spacecraft, Trajectories, & Navigation*, Encyclopedia Britannica, viewed 31 May 2026, <https://www.britannica.com/science/spaceflight#ref741469>.

Rickman, S 2020, *Introduction to Orbital Mechanics and Spacecraft Attitudes for Thermal Engineers*.

*The Tyranny of the Rocket Equation* 2019, Astronomical Returns.

*Section 4.4 - Types of Orbits and Orbital Maneuvers* n.d., Astronomical Returns.

## Notes

1. In this chapter, altitude can refer to the value of the apoapsis or periapsis, as well as the vessel's current orbital radius.
2. When dealing with Trans Primary Injections, the moon is referred to as the secondary body, and the body which it orbits is known as the primary.
